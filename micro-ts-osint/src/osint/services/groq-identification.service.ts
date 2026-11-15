import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { GroqKeyRotationService, GroqModelType } from './groq-key-rotation.service';

export interface PersonIdentification {
  name?: string;
  surname?: string;
  fullName?: string;
  username?: string;
  position?: string;
  organization?: string;
  location?: string;
  confidence: number;
  reasoning: string;
  sources: string[];
  alternativeNames?: string[];
  relatedEntities?: string[];
}

export interface IdentificationContext {
  imageAnalysis?: {
    age?: string;
    gender?: string;
    ethnicity?: string;
    distinctiveFeatures?: string[];
  };
  searchResults?: Array<{
    title: string;
    snippet: string;
    url: string;
  }>;
  crawledContent?: Array<{
    url: string;
    title: string;
    content: string;
    emails?: string[];
    phones?: string[];
  }>;
  socialMediaProfiles?: {
    facebook?: string[];
    instagram?: string[];
    twitter?: string[];
    linkedin?: string[];
    tiktok?: string[];
  };
}

@Injectable()
export class GroqIdentificationService {
  private readonly logger = new Logger(GroqIdentificationService.name);
  private readonly apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
  private readonly model = 'llama-3.3-70b-versatile'; // Best for reasoning

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly groqKeyRotation: GroqKeyRotationService,
  ) {
    this.logger.log('🧠 GroqIdentificationService initialized (using key rotation pool)');
  }

  /**
   * Identify a person from OSINT context
   */
  async identifyPerson(
    context: IdentificationContext,
  ): Promise<PersonIdentification> {
    if (!this.groqKeyRotation.isAvailable()) {
      throw new Error('No alive Groq API keys available');
    }

    this.logger.log('🔍 Starting person identification with Groq...');

    try {
      const prompt = this.buildIdentificationPrompt(context);
      const response = await this.callGroqAPI(prompt, {
        temperature: 0.3, // Low temperature for factual responses
        max_tokens: 2000,
      });

      const identification = this.parseIdentificationResponse(response);
      this.logger.log(
        `✅ Person identified with ${identification.confidence}% confidence`,
      );

      return identification;
    } catch (error) {
      this.logger.error(`❌ Identification failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract names from unstructured text
   */
  async extractNames(text: string): Promise<string[]> {
    if (!this.groqKeyRotation.isAvailable()) {
      throw new Error('No alive Groq API keys available');
    }

    const prompt = `Extract all person names from the following text. Return only the names, one per line, without any additional information.

Text:
${text}

Names:`;

    try {
      const response = await this.callGroqAPI(prompt, {
        temperature: 0.1,
        max_tokens: 500,
      });

      return response
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('-'));
    } catch (error) {
      this.logger.error(`Name extraction failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Analyze context to determine if multiple sources refer to the same person
   */
  async verifySamePerson(
    context1: IdentificationContext,
    context2: IdentificationContext,
  ): Promise<{
    isSamePerson: boolean;
    confidence: number;
    reasoning: string;
  }> {
    if (!this.groqKeyRotation.isAvailable()) {
      throw new Error('No alive Groq API keys available');
    }

    const prompt = `Analyze the following two contexts and determine if they refer to the same person. Consider:
- Physical characteristics
- Names and usernames
- Locations and organizations
- Social media profiles
- Distinctive features

Context 1:
${JSON.stringify(context1, null, 2)}

Context 2:
${JSON.stringify(context2, null, 2)}

Respond in JSON format:
{
  "isSamePerson": true/false,
  "confidence": 0-100,
  "reasoning": "Detailed explanation"
}`;

    try {
      const response = await this.callGroqAPI(prompt, {
        temperature: 0.2,
        max_tokens: 1000,
      });

      return this.parseJsonResponse(response);
    } catch (error) {
      this.logger.error(`Person verification failed: ${error.message}`);
      return {
        isSamePerson: false,
        confidence: 0,
        reasoning: 'Verification failed due to API error',
      };
    }
  }

  /**
   * Build detailed identification prompt
   */
  private buildIdentificationPrompt(context: IdentificationContext): string {
    let prompt = `You are an expert OSINT analyst. Analyze the following information to identify a person. Extract:
- Full name (first and last name)
- Username or handle (if mentioned)
- Position/job title
- Organization/company
- Location
- Any other relevant identifying information

Be precise and only include information that is clearly stated. If uncertain, indicate low confidence.

CONTEXT:
`;

    // Add image analysis
    if (context.imageAnalysis) {
      prompt += `\n## Physical Characteristics:\n`;
      prompt += `- Age: ${context.imageAnalysis.age || 'Unknown'}\n`;
      prompt += `- Gender: ${context.imageAnalysis.gender || 'Unknown'}\n`;
      prompt += `- Ethnicity: ${context.imageAnalysis.ethnicity || 'Unknown'}\n`;
      if (context.imageAnalysis.distinctiveFeatures?.length) {
        prompt += `- Distinctive Features: ${context.imageAnalysis.distinctiveFeatures.join(', ')}\n`;
      }
    }

    // Add search results
    if (context.searchResults?.length) {
      prompt += `\n## Search Results:\n`;
      context.searchResults.forEach((result, i) => {
        prompt += `\n${i + 1}. ${result.title}\n`;
        prompt += `   URL: ${result.url}\n`;
        if (result.snippet) {
          prompt += `   Snippet: ${result.snippet}\n`;
        }
      });
    }

    // Add crawled content
    if (context.crawledContent?.length) {
      prompt += `\n## Crawled Web Pages:\n`;
      context.crawledContent.forEach((content, i) => {
        prompt += `\n${i + 1}. ${content.title} (${content.url})\n`;
        // Include first 500 chars of content
        const excerpt = content.content.substring(0, 500);
        prompt += `   Content excerpt: ${excerpt}...\n`;
        if (content.emails?.length) {
          prompt += `   Emails found: ${content.emails.join(', ')}\n`;
        }
        if (content.phones?.length) {
          prompt += `   Phones found: ${content.phones.join(', ')}\n`;
        }
      });
    }

    // Add social media profiles
    if (context.socialMediaProfiles) {
      prompt += `\n## Social Media Profiles:\n`;
      Object.entries(context.socialMediaProfiles).forEach(
        ([platform, profiles]) => {
          if (profiles && profiles.length > 0) {
            prompt += `- ${platform}: ${profiles.join(', ')}\n`;
          }
        },
      );
    }

    prompt += `\n\nRESPONSE FORMAT (JSON only):
{
  "name": "First name",
  "surname": "Last name",
  "fullName": "Full name as found",
  "username": "Social media handle or username",
  "position": "Job title or role",
  "organization": "Company or organization",
  "location": "City, Country",
  "confidence": 0-100,
  "reasoning": "Detailed explanation of how you identified this person",
  "sources": ["URL 1", "URL 2"],
  "alternativeNames": ["Alternative name or alias"],
  "relatedEntities": ["Related people or organizations"]
}

Respond ONLY with the JSON object, no additional text.`;

    return prompt;
  }

  /**
   * Call Groq API
   */
  private async callGroqAPI(
    prompt: string,
    options: { temperature?: number; max_tokens?: number } = {},
  ): Promise<string> {
    // 🔑 Request a key from the rotation pool
    const keyResult = await this.groqKeyRotation.getAvailableKey(this.model);
    this.logger.debug(`🔑 Using key [${keyResult.keyIndex}] for model ${this.model}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          this.apiUrl,
          {
            model: this.model,
            messages: [
              {
                role: 'system',
                content:
                  'You are an expert OSINT analyst. Provide accurate, factual information based on the given context. Always respond in valid JSON format when requested.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: options.temperature || 0.3,
            max_tokens: options.max_tokens || 2000,
          },
          {
            headers: {
              Authorization: `Bearer ${keyResult.apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      // ✅ Register usage only AFTER successful call
      await this.groqKeyRotation.registerUsage(keyResult.keyIndex, keyResult.modelType);

      return response.data.choices[0].message.content;
    } catch (error) {
      // Detectar 429 y notificar al pool de keys
      const status = error.response?.status ?? error.status;
      if (status === 429) {
        const retryAfter = parseInt(error.response?.headers?.['retry-after'] ?? '5', 10);
        await this.groqKeyRotation.handle429(keyResult.keyIndex, retryAfter);
        this.logger.warn(`Groq 429 on key [${keyResult.keyIndex}] — cooldown ${retryAfter}s`);
      }
      if (error.response) {
        this.logger.error(
          `Groq API error (key [${keyResult.keyIndex}]): ${JSON.stringify(error.response.data)}`,
        );
      }
      throw error;
    }
  }

  /**
   * Parse identification response from Groq
   */
  private parseIdentificationResponse(response: string): PersonIdentification {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        name: parsed.name || undefined,
        surname: parsed.surname || undefined,
        fullName: parsed.fullName || undefined,
        username: parsed.username || undefined,
        position: parsed.position || undefined,
        organization: parsed.organization || undefined,
        location: parsed.location || undefined,
        confidence: parsed.confidence || 0,
        reasoning: parsed.reasoning || 'No reasoning provided',
        sources: parsed.sources || [],
        alternativeNames: parsed.alternativeNames || [],
        relatedEntities: parsed.relatedEntities || [],
      };
    } catch (error) {
      this.logger.error(`Failed to parse Groq response: ${error.message}`);
      this.logger.debug(`Raw response: ${response}`);

      // Return low-confidence result
      return {
        confidence: 0,
        reasoning: 'Failed to parse API response',
        sources: [],
      };
    }
  }

  /**
   * Parse generic JSON response
   */
  private parseJsonResponse(response: string): any {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      this.logger.error(`JSON parsing failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Calculate confidence score based on available data
   */
  calculateConfidence(identification: PersonIdentification): number {
    let confidence = 0;

    if (
      identification.fullName ||
      (identification.name && identification.surname)
    ) {
      confidence += 30;
    }
    if (identification.username) confidence += 15;
    if (identification.position) confidence += 15;
    if (identification.organization) confidence += 15;
    if (identification.location) confidence += 10;
    if (identification.sources?.length > 0) {
      confidence += Math.min(identification.sources.length * 5, 15);
    }

    return Math.min(confidence, 100);
  }
}
