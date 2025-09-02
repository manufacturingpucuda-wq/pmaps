# PUCUDA MFG Inventory System

## Overview

A modern inventory management system built for PUCUDA MFG that handles item tracking, order management, and checkout operations. The system is designed as a full-stack web application with a React frontend and Express backend, providing comprehensive inventory control with real-time stock tracking, barcode generation, and order fulfillment capabilities.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript for type safety and modern component patterns
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query (React Query) for server state management and caching
- **UI Framework**: Radix UI components with shadcn/ui design system
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **Form Handling**: React Hook Form with Zod schema validation
- **Build Tool**: Vite for fast development and optimized production builds

### Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **Data Storage**: In-memory storage with interface-based design for easy database migration
- **API Design**: RESTful API with JSON responses
- **Validation**: Zod schemas shared between frontend and backend
- **Development**: Hot reload with Vite integration

### Database Design
- **Schema**: Drizzle ORM with PostgreSQL dialect configuration
- **Tables**: 
  - Items (inventory with stock tracking and status)
  - Orders (with customer info and fulfillment status)
  - Order Items (many-to-many relationship with quantity tracking)
- **Features**: UUID primary keys, timestamps, enum constraints, foreign key relationships

### Key Features
- **Inventory Management**: Add, edit, delete items with real-time stock tracking
- **Order System**: Create orders, add items, track fulfillment status
- **Checkout Process**: Multi-step checkout with cart functionality
- **Barcode Generation**: Dynamic barcode creation using JsBarcode library
- **Analytics Dashboard**: Inventory statistics and recent activity tracking
- **Responsive Design**: Mobile-first approach with adaptive sidebar

### Authentication & Security
- Currently implements session-based approach (placeholder for future auth implementation)
- CORS configuration for development environment
- Input validation on both client and server sides

### Development Features
- **Development Tools**: Replit integration with error overlay and cartographer
- **Code Quality**: TypeScript strict mode, ESLint configuration
- **Hot Reload**: Vite HMR for instant development feedback
- **Path Aliases**: Organized imports with @ and @shared prefixes

## External Dependencies

### Core Framework Dependencies
- **@neondatabase/serverless**: PostgreSQL database connectivity
- **drizzle-orm**: Type-safe SQL query builder and ORM
- **express**: Web application framework for API endpoints
- **react**: Frontend UI library with hooks and context
- **@tanstack/react-query**: Server state management and caching

### UI Component Libraries
- **@radix-ui/***: Comprehensive set of accessible, unstyled UI primitives
- **tailwindcss**: Utility-first CSS framework for styling
- **lucide-react**: Icon library for consistent iconography
- **react-hook-form**: Form state management and validation

### Development Tools
- **vite**: Build tool and development server
- **typescript**: Static type checking and enhanced developer experience
- **drizzle-kit**: Database migration and schema management
- **@replit/vite-plugin-***: Replit-specific development enhancements

### Utility Libraries
- **zod**: Runtime type validation and schema definition
- **wouter**: Lightweight routing for single-page applications
- **clsx & tailwind-merge**: Conditional CSS class management
- **date-fns**: Date manipulation and formatting utilities

### Barcode Generation
- **JsBarcode**: External CDN library for CODE128 barcode generation
- Dynamically loaded for print functionality and label creation

### AI-Powered Assistant
- **Local AI Assistant**: Built-in intelligent help system without external API dependencies
- **Knowledge Base**: Comprehensive warehouse operations guidance covering inventory, orders, transactions, and reports
- **Context-Aware Responses**: Smart keyword matching and contextual help based on user queries
- **Quick Actions**: Predefined assistance for common warehouse tasks and operations
- **Real-time Chat Interface**: Interactive conversation-style help with suggestions and guidance