# BrickBase Backend

NestJS backend service for the BrickBase real estate tokenization platform.

## Technology Stack

- **Framework**: NestJS
- **Language**: TypeScript
- **Database**: MongoDB with Mongoose
- **Storage**: IPFS
- **Documentation**: Swagger/OpenAPI
- **Authentication**: Passport/JWT
- **Configuration**: Environment Variables

## Project Structure

```
src/
├── app.module.ts              # Main application module
├── main.ts                    # Application entry point
├── modules/                   # Feature modules
│   ├── auth/                 # Authentication
│   ├── properties/           # Property management
│   ├── users/               # User management
│   └── transactions/        # Transaction handling
├── common/                   # Shared resources
│   ├── decorators/
│   ├── filters/
│   ├── guards/
│   ├── interfaces/
│   └── pipes/
└── config/                   # Configuration
    ├── database.config.ts
    └── swagger.config.ts
```

## Features

- **Property Management**
  - Property tokenization
  - Metadata storage
  - Document management

- **User Management**
  - Authentication
  - Authorization
  - Profile management

- **Transaction Handling**
  - Transaction recording
  - History tracking
  - Status updates

## Getting Started

### Prerequisites
- Node.js >= 18
- MongoDB
- IPFS node (optional)

### Installation

1. Clone the repository
```
git clone https://github.com/Ewid/brickbase-backend.git
cd brickbase-backend
```

2. Install dependencies
```
npm install
```

3. Set up environment variables
```
cp .env.example .env
```

4. Start the development server
```
npm run start:dev
```

### Environment Configuration

```
# Server
PORT=3001
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/brickbase

# JWT
JWT_SECRET=your_jwt_secret
JWT_EXPIRATION=1d

# IPFS
IPFS_NODE=your_ipfs_node
```

## Development

### Commands

```
# Development
npm run start:dev

# Production build
npm run build

# Production start
npm run start:prod

# Tests
npm run test
npm run test:e2e
npm run test:cov
```

## API Documentation

Swagger documentation is available at `/api` when running the server.

## Testing

```
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## Project Modules

### Auth Module
- JWT authentication
- Role-based access control
- User registration and login

### Properties Module
- Property creation and management
- Metadata handling
- Document storage with IPFS

### Users Module
- User profile management
- Investment tracking
- Portfolio management

### Transactions Module
- Transaction recording
- History tracking
- Status management
