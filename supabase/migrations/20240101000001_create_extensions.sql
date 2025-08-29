-- Enable required PostgreSQL extensions
-- This migration sets up the foundational extensions needed for GeoScore AI

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgvector for embeddings storage
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pgcrypto for password hashing and encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enable pg_stat_statements for query performance monitoring
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Enable postgis for geographic data (if needed for location-based features)
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- Create custom types for common enums
CREATE TYPE job_status AS ENUM ('queued', 'running', 'failed', 'complete');
CREATE TYPE job_type AS ENUM ('brand_onboard', 'crawl', 'normalize', 'embed', 'sample', 'score', 'assemble_report');
CREATE TYPE user_role AS ENUM ('brand_user', 'admin', 'super_admin');
CREATE TYPE api_key_status AS ENUM ('active', 'retiring', 'disabled', 'unhealthy');
CREATE TYPE service_type AS ENUM ('llm', 'serp', 'embedding', 'connector');