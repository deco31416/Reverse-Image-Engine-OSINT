import axios from 'axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HuggingFaceImageService {
  private readonly logger = new Logger(HuggingFaceImageService.name);
  private readonly hfToken: string;
  private readonly models: string[];
  private readonly timeoutMs: number;
  private readonly conditionedEnabled: boolean;
  private readonly identityScale: number;
  private readonly controlnetScale: number;
  private readonly customInferenceEndpoint?: string;

  constructor(private readonly configService: ConfigService) {
    this.hfToken = this.configService.get<string>('HUGGINGFACE_TOKEN') || '';

    const configuredModels =
      this.configService.get<string>('HUGGINGFACE_IMAGE_MODELS') ||
      this.configService.get<string>('HUGGINGFACE_IMAGE_MODEL') ||
      [
        'stabilityai/stable-diffusion-xl-base-1.0',
        'runwayml/stable-diffusion-v1-5',
        'stabilityai/stable-diffusion-2-1',
        'CompVis/stable-diffusion-v1-4',
      ].join(',');

    this.models = configuredModels
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    this.timeoutMs = Number(
      this.configService.get<string>('HUGGINGFACE_IMAGE_TIMEOUT_MS') ||
        '240000',
    );

    this.conditionedEnabled =
      (this.configService
        .get<string>('HUGGINGFACE_CONDITIONED_ENABLED')
        ?.trim()
        .toLowerCase() || 'true') === 'true';

    this.identityScale = Number(
      this.configService.get<string>('HUGGINGFACE_IDENTITY_SCALE') || '1.0',
    );

    this.controlnetScale = Number(
      this.configService.get<string>('HUGGINGFACE_CONTROLNET_SCALE') || '0.85',
    );

    this.customInferenceEndpoint =
      this.configService
        .get<string>('HUGGINGFACE_INFERENCE_ENDPOINT')
        ?.trim() || undefined;

    if (!this.hfToken) {
      this.logger.warn('HUGGINGFACE_TOKEN not configured.');
    }

    if (this.conditionedEnabled) {
      this.logger.log(
        'HF conditioned identity pipeline enabled (InstantID/IP-Adapter/ControlNet style payloads).',
      );
    }
  }

  /**
   * Generate a side profile image from a frontal image using Hugging Face SDXL
   * @param frontImageBase64 - base64 string (data:image/jpeg;base64,...)
   * @param prompt - prompt for the side profile
   * @param strength - degree of transformation (0.7 recommended)
   */
  async generateProfile(
    frontImageBase64: string,
    prompt: string,
    strength = 0.7,
  ): Promise<string | undefined> {
    if (!this.hfToken) {
      throw new Error('HUGGINGFACE_TOKEN missing');
    }

    const base64 = frontImageBase64.replace(
      /^data:image\/[a-zA-Z]+;base64,/,
      '',
    );
    const payload = {
      inputs: base64,
      parameters: {
        prompt,
        strength,
        guidance_scale: 7.5,
        num_inference_steps: 30,
        num_images: 1,
        width: 768,
        height: 1024,
        negative_prompt:
          'two people, multiple people, duplicate person, double face, two heads, extra face, collage, split screen, diptych, group photo, front view, three-quarter view, painting, cartoon, anime, illustration, dark background, complex background, text, watermark',
      },
      options: {
        wait_for_model: true,
      },
    };

    const profileDirection = this.getDirectionFromPrompt(prompt);
    const payloadVariants = this.conditionedEnabled
      ? this.buildConditionedPayloadVariants(
          base64,
          prompt,
          strength,
          profileDirection,
        )
      : [
          payload,
          {
            inputs: {
              image: base64,
              prompt,
            },
            parameters: {
              strength,
              guidance_scale: 7.5,
              num_inference_steps: 30,
              num_images: 1,
              width: 768,
              height: 1024,
              negative_prompt:
                'two people, multiple people, duplicate person, double face, two heads, extra face, collage, split screen, diptych, group photo, front view, three-quarter view, painting, cartoon, anime, illustration, dark background, complex background, text, watermark',
            },
            options: {
              wait_for_model: true,
            },
          },
        ];

    const failures: string[] = [];

    const endpointConfigs = this.getEndpointConfigs();

    for (const endpointConfig of endpointConfigs) {
      const { label: model, endpoint } = endpointConfig;
      try {
        for (const candidate of payloadVariants) {
          const response = await axios.post(endpoint, candidate, {
            headers: {
              Authorization: `Bearer ${this.hfToken}`,
              'Content-Type': 'application/json',
              Accept: 'image/png',
            },
            responseType: 'arraybuffer',
            timeout: this.timeoutMs,
            validateStatus: () => true,
          });

          if (response.status >= 400) {
            const asText = Buffer.from(response.data)
              .toString('utf8')
              .slice(0, 220);
            failures.push(
              `${model} @ ${endpoint}: HTTP ${response.status} ${asText}`,
            );
            continue;
          }

          const contentType =
            (response.headers['content-type'] as string | undefined) ||
            'image/png';

          if (contentType.includes('application/json')) {
            const asText = Buffer.from(response.data)
              .toString('utf8')
              .slice(0, 220);
            failures.push(`${model} @ ${endpoint}: JSON inesperado ${asText}`);
            continue;
          }

          const resultBase64 = Buffer.from(response.data).toString('base64');
          this.logger.log(
            `Hugging Face profile generated with model: ${model} via ${endpoint}`,
          );
          return `data:${contentType};base64,${resultBase64}`;
        }
      } catch (error: unknown) {
        const e = error as {
          response?: { status?: number; data?: Buffer | ArrayBuffer | string };
          message?: string;
        };

        const status = e.response?.status;
        let raw = '';
        if (e.response?.data) {
          if (typeof e.response.data === 'string') {
            raw = e.response.data;
          } else {
            raw = Buffer.from(e.response.data as ArrayBuffer).toString('utf8');
          }
        }

        const details = (raw || e.message || 'unknown error').slice(0, 220);
        failures.push(`${model}: ${status || 'ERR'} ${details}`);
      }
    }

    const compact = failures.slice(0, 3).join(' | ');
    this.logger.error(
      `Hugging Face profile generation failed after trying ${this.models.length} model(s): ${compact}`,
    );
    throw new Error(
      `Hugging Face fallo (${this.models.length} modelos): ${compact}`,
    );
  }

  private getEndpointConfigs(): Array<{ label: string; endpoint: string }> {
    if (this.customInferenceEndpoint) {
      return [
        {
          label: 'custom-conditioned-endpoint',
          endpoint: this.customInferenceEndpoint.replace(/\/$/, ''),
        },
      ];
    }

    return this.models.map((model) => ({
      label: model,
      endpoint: `https://router.huggingface.co/hf-inference/models/${model}`,
    }));
  }

  private getDirectionFromPrompt(prompt: string): 'left' | 'right' {
    const p = prompt.toLowerCase();
    if (p.includes('right') || p.includes('derecho')) {
      return 'right';
    }
    return 'left';
  }

  private buildConditionedPayloadVariants(
    base64: string,
    prompt: string,
    strength: number,
    direction: 'left' | 'right',
  ): any[] {
    const directionToken =
      direction === 'left' ? 'left profile' : 'right profile';
    const conditionedPrompt = `${prompt}. STRICT: output exactly one person, ${directionToken}, 90-degree side view, plain pure white background.`;
    const negativePrompt =
      'two people, multiple people, duplicate person, double face, two heads, extra face, collage, split screen, diptych, group photo, front view, three-quarter view, painting, cartoon, anime, illustration, dark background, complex background, text, watermark';

    // Different model backends expect different keys for identity/control conditioning.
    // We send multiple compatible variants and accept the first successful image.
    return [
      {
        inputs: {
          prompt: conditionedPrompt,
          image: base64,
          ip_adapter_image: base64,
          control_image: base64,
          identity_image: base64,
        },
        parameters: {
          strength,
          guidance_scale: 6.5,
          num_inference_steps: 28,
          num_images: 1,
          width: 768,
          height: 1024,
          negative_prompt: negativePrompt,
          ip_adapter_scale: this.identityScale,
          adapter_conditioning_scale: this.identityScale,
          controlnet_conditioning_scale: this.controlnetScale,
        },
        options: {
          wait_for_model: true,
          use_cache: false,
        },
      },
      {
        inputs: base64,
        parameters: {
          prompt: conditionedPrompt,
          strength,
          guidance_scale: 6.5,
          num_inference_steps: 28,
          num_images: 1,
          width: 768,
          height: 1024,
          negative_prompt: negativePrompt,
          image: base64,
          ip_adapter_image: base64,
          control_image: base64,
          identity_image: base64,
          ip_adapter_scale: this.identityScale,
          adapter_conditioning_scale: this.identityScale,
          controlnet_conditioning_scale: this.controlnetScale,
        },
        options: {
          wait_for_model: true,
          use_cache: false,
        },
      },
      {
        inputs: {
          image: base64,
          prompt: conditionedPrompt,
          negative_prompt: negativePrompt,
        },
        parameters: {
          strength,
          guidance_scale: 6.5,
          num_inference_steps: 28,
          num_images: 1,
          width: 768,
          height: 1024,
          ip_adapter_image: base64,
          reference_image: base64,
          control_image: base64,
          adapter_conditioning_scale: this.identityScale,
          controlnet_conditioning_scale: this.controlnetScale,
        },
        options: {
          wait_for_model: true,
          use_cache: false,
        },
      },
    ];
  }
}
