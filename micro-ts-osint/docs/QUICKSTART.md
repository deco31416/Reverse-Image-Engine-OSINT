# 🚀 Quick Start Guide - OSINT God-Level

## Prerequisites

- Node.js 18+ 
- MongoDB (local or Atlas)
- Redis (local or Upstash)
- API Keys (Google, Gemini, Groq)

## Local Setup

### 1. Install Dependencies

```bash
cd micro-ts-osint
yarn install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your credentials:

```bash
# Required
MONGODB_URI=mongodb://localhost:27017/ia-cam-osint
REDIS_URL=redis://localhost:6379

# API Keys
GOOGLE_API_KEY=your_key
GOOGLE_CSE_ID=your_cse_id
GEMINI_API_KEY=your_key
GROQ_API_KEY=your_key
CLOUDINARY_CLOUD_NAME=your_name
CLOUDINARY_API_KEY=your_key
CLOUDINARY_API_SECRET=your_secret
```

### 3. Start MongoDB & Redis

**Option A: Docker (if you have it)**
```bash
docker run -d -p 27017:27017 --name mongodb mongo:latest
docker run -d -p 6379:6379 --name redis redis:latest
```

**Option B: Cloud Services**
- MongoDB: [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) (free 512MB)
- Redis: [Upstash](https://upstash.com) (free 10K commands/day)

### 4. Start Development Server

```bash
yarn start:dev
```

Server runs on: `http://localhost:7105`

## API Endpoints

### Health Check
```bash
GET http://localhost:7105
```

### Create OSINT Search
```bash
POST http://localhost:7105/osint/search
Content-Type: application/json

{
  "query": "Juan Pérez",
  "searchType": "person",
  "category": "identity",
  "tags": ["test"],
  "autoRefresh": false
}
```

### Get All Searches
```bash
GET http://localhost:7105/osint/search
```

### Get Evidence for Search
```bash
GET http://localhost:7105/osint/evidence/:searchId
```

### Get Audit Logs
```bash
GET http://localhost:7105/osint/audit-logs
```

### Get Rate Limit Stats
```bash
GET http://localhost:7105/osint/rate-limits
```

## Testing New Features

### 1. Evidence System (Deduplication)
```bash
# Create evidence - run twice, should deduplicate
POST http://localhost:7105/osint/evidence
{
  "searchId": "your_search_id",
  "source": "Google CSE",
  "category": "identity",
  "title": "Test Evidence",
  "summary": "This is a test",
  "url": "https://example.com",
  "reliability": 0.8
}
```

### 2. Regex Extraction
```bash
# Extract data from text
POST http://localhost:7105/osint/extract
{
  "text": "Contact: juan@example.com, phone: 5551234567, RFC: ABCD123456XYZ"
}

# Response:
{
  "emails": ["juan@example.com"],
  "phones": ["5551234567"],
  "rfcs": ["ABCD123456XYZ"],
  "curps": [],
  "urls": [],
  "ips": []
}
```

### 3. Rate Limiting
```bash
# Check Groq usage (600/day limit)
GET http://localhost:7105/osint/rate-limits/groq

# Response:
{
  "service": "groq",
  "todayUsage": 45,
  "dailyLimit": 600,
  "remainingToday": 555,
  "percentageUsed": 7.5,
  "resetIn": "18h 23m"
}
```

### 4. Audit Logs
```bash
# View recent actions
GET http://localhost:7105/osint/audit-logs?limit=20

# Filter by action
GET http://localhost:7105/osint/audit-logs?action=search_created

# Get stats
GET http://localhost:7105/osint/audit-logs/stats
```

## Project Structure

```
micro-ts-osint/
├── src/
│   ├── osint/
│   │   ├── schemas/           # 🔥 Mongoose schemas
│   │   │   ├── evidence.schema.ts
│   │   │   ├── audit-log.schema.ts
│   │   │   └── osint-search.schema.ts
│   │   ├── services/          # 🔥 God-Level services
│   │   │   ├── evidence.service.ts         # SHA256 deduplication
│   │   │   ├── rate-limit.service.ts       # Redis rate limiting
│   │   │   ├── regex-extractor.service.ts  # Auto extraction
│   │   │   ├── audit-log.service.ts        # Compliance logs
│   │   │   ├── cloudinary.service.ts
│   │   │   ├── gemini-image-enhancement.service.ts
│   │   │   ├── groq-identification.service.ts
│   │   │   ├── reverse-image-search.service.ts
│   │   │   └── web-crawler.service.ts
│   │   ├── dto/               # Request/Response DTOs
│   │   ├── interfaces/        # TypeScript interfaces
│   │   ├── osint.controller.ts
│   │   ├── osint.service.ts
│   │   └── osint.module.ts
│   ├── app.module.ts          # 🔥 MongoDB + Redis config
│   └── main.ts
├── docs/
│   ├── MASTER-IMPLEMENTATION-PLAN.md
│   ├── python-best-practices-extraction.md
│   └── osint-escalable-operador-demo.md
├── RAILWAY.md                 # Railway deployment guide
├── QUICKSTART.md              # This file
├── package.json
└── .env.example
```

## Features Implemented ✅

### Phase 1 (Completed)
- ✅ MongoDB with Mongoose schemas
- ✅ Redis client with auto-reconnect
- ✅ Evidence System with SHA256 deduplication
- ✅ RegexExtractor Service (emails, phones, RFCs, CURPs)
- ✅ Rate Limiting Service with Redis
- ✅ Audit Log System
- ✅ Module configuration

### Coming Next (Phase 2)
- ⏳ Multi-dimensional Scoring
- ⏳ Input Multi-Modal (image + personal data)
- ⏳ Markdown Report Generator
- ⏳ Clustering Service (A-Z organization)

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 7105 | Server port |
| `NODE_ENV` | No | development | Environment |
| `MONGODB_URI` | Yes | - | MongoDB connection string |
| `REDIS_URL` | Yes | - | Redis connection string |
| `GOOGLE_API_KEY` | Yes | - | Google APIs |
| `GOOGLE_CSE_ID` | Yes | - | Custom Search Engine ID |
| `GEMINI_API_KEY` | Yes | - | Gemini AI |
| `GROQ_API_KEY` | Yes | - | Groq AI |
| `CLOUDINARY_CLOUD_NAME` | Yes | - | Cloudinary storage |
| `CLOUDINARY_API_KEY` | Yes | - | Cloudinary key |
| `CLOUDINARY_API_SECRET` | Yes | - | Cloudinary secret |
| `YOUTUBE_API_KEY` | No | - | YouTube Data API |
| `TWITTER_BEARER_TOKEN` | No | - | Twitter API |

## Troubleshooting

### MongoDB Connection Failed
```bash
# Check if MongoDB is running
mongosh --eval "db.version()"

# Or use MongoDB Atlas connection string:
MONGODB_URI=mongodb+srv://<mongo-user>:<mongo-password>@cluster.mongodb.net/osint?retryWrites=true
```

### Redis Connection Failed
```bash
# Check if Redis is running
redis-cli ping

# Or use Upstash connection string:
REDIS_URL=rediss://default:password@endpoint.upstash.io:6379
```

### Rate Limit Not Working
```bash
# Verify Redis is connected
curl http://localhost:7105/osint/rate-limits/health
```

### Evidence Not Deduplicating
```bash
# Check MongoDB connection
# Verify evidenceId is being generated
# Look for logs: "Evidence xyz already exists (deduplicated)"
```

## Next Steps

1. ✅ Set up MongoDB + Redis
2. ✅ Configure API keys
3. ⏳ Test evidence deduplication
4. ⏳ Test rate limiting
5. ⏳ Implement Phase 2 (Scoring)
6. ⏳ Deploy to Railway

---

**Need help?** Check the documentation:
- [Master Implementation Plan](./docs/MASTER-IMPLEMENTATION-PLAN.md)
- [Railway Deployment](./RAILWAY.md)
- [Python Best Practices](./docs/python-best-practices-extraction.md)
