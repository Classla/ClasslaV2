# Classla LMS

A comprehensive learning management system built with React and Express.js.

## Project Structure

```
classla-lms/
├── classla-backend/          # Express.js TypeScript backend
│   ├── src/
│   │   └── server.ts        # Main server file
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── classla-frontend/         # React TypeScript frontend
│   ├── src/
│   │   ├── App.tsx          # Main app component
│   │   ├── main.tsx         # Entry point
│   │   └── test/            # Test setup
│   ├── package.json
│   ├── vite.config.ts
│   └── .env.example
└── data_models.ts           # Shared TypeScript interfaces
```

## Getting Started

### Backend Setup

1. Navigate to the backend directory:

   ```bash
   cd classla-backend
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

4. Update `.env` with your Supabase credentials

5. Start the development server:
   ```bash
   npm run dev
   ```

The backend will run on `http://localhost:3001`

### Frontend Setup

1. Navigate to the frontend directory:

   ```bash
   cd classla-frontend
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

4. Update `.env` with your Supabase credentials

5. Start the development server:
   ```bash
   npm run dev
   ```

The frontend will run on `http://localhost:5173`

## Technology Stack

### Backend

- **Framework**: Express.js with TypeScript
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Testing**: Jest

### Frontend

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Routing**: React Router
- **HTTP Client**: Axios
- **Testing**: Vitest + React Testing Library

## Development

- Backend API endpoints will be available at `/api/*`
- Frontend development server proxies API calls to the backend
- Both projects use TypeScript for type safety
- Environment variables are required for Supabase integration

## Next Steps

Follow the implementation tasks in `.kiro/specs/classla-lms/tasks.md` to continue building the application features.
