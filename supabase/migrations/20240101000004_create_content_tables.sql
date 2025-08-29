-- Content storage and processing tables
-- This migration creates tables for raw content, claims extraction, and embeddings

-- Raw pages table - S3 pointers and content metadata
CREATE TABLE IF NOT EXISTS raw_pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    url TEXT NOT NULL,
    canonical_url TEXT,
    content_hash TEXT NOT NULL,
    html_s3_path TEXT, -- S3 path to stored HTML content
    status_code INTEGER,
    fetch_time TIMESTAMP WITH TIME ZONE NOT NULL,
    is_blocked BOOLEAN DEFAULT false, -- True if blocked by robots.txt
    metadata JSONB DEFAULT '{}', -- Store headers, redirect chains, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (status_code >= 100 AND status_code < 600)
);

-- Claims table - Extracted claims with evidence
CREATE TABLE IF NOT EXISTS claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    raw_page_id UUID REFERENCES raw_pages(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    source_url TEXT NOT NULL,
    confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
    evidence JSONB DEFAULT '[]', -- Array of evidence objects
    claim_type TEXT, -- e.g., 'product', 'service', 'location', 'contact'
    extracted_by TEXT, -- Method used: 'heuristic', 'llm', 'manual'
    is_verified BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Embeddings table - pgvector integration for semantic search
CREATE TABLE IF NOT EXISTS embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL, -- 'raw_page', 'claim', 'llm_result'
    source_id UUID NOT NULL, -- References the source table
    content TEXT NOT NULL, -- The text content that was embedded
    embedding vector(1536), -- OpenAI ada-002 dimension, adjust as needed
    model_name TEXT NOT NULL DEFAULT 'text-embedding-ada-002',
    chunk_index INTEGER DEFAULT 0, -- For large content split into chunks
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CHECK (source_type IN ('raw_page', 'claim', 'llm_result')),
    UNIQUE(source_type, source_id, chunk_index)
);

-- Content normalization results
CREATE TABLE IF NOT EXISTS normalized_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    raw_page_id UUID NOT NULL REFERENCES raw_pages(id) ON DELETE CASCADE,
    title TEXT,
    description TEXT,
    main_text TEXT,
    json_ld JSONB DEFAULT '{}', -- Structured data
    meta_tags JSONB DEFAULT '{}',
    word_count INTEGER,
    language TEXT,
    readability_score FLOAT,
    extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_raw_pages_brand_id ON raw_pages(brand_id);
CREATE INDEX idx_raw_pages_url ON raw_pages(url);
CREATE INDEX idx_raw_pages_canonical_url ON raw_pages(canonical_url);
CREATE INDEX idx_raw_pages_content_hash ON raw_pages(content_hash);
CREATE INDEX idx_raw_pages_fetch_time ON raw_pages(fetch_time DESC);
CREATE INDEX idx_raw_pages_status_code ON raw_pages(status_code);
CREATE INDEX idx_raw_pages_job_id ON raw_pages(job_id);

CREATE INDEX idx_claims_brand_id ON claims(brand_id);
CREATE INDEX idx_claims_raw_page_id ON claims(raw_page_id);
CREATE INDEX idx_claims_source_url ON claims(source_url);
CREATE INDEX idx_claims_claim_type ON claims(claim_type);
CREATE INDEX idx_claims_confidence ON claims(confidence DESC);
CREATE INDEX idx_claims_is_verified ON claims(is_verified);
CREATE INDEX idx_claims_extracted_by ON claims(extracted_by);

-- Vector similarity index for embeddings
CREATE INDEX idx_embeddings_brand_id ON embeddings(brand_id);
CREATE INDEX idx_embeddings_source ON embeddings(source_type, source_id);
CREATE INDEX idx_embeddings_model_name ON embeddings(model_name);
CREATE INDEX idx_embeddings_vector ON embeddings USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_normalized_content_raw_page_id ON normalized_content(raw_page_id);
CREATE INDEX idx_normalized_content_language ON normalized_content(language);
CREATE INDEX idx_normalized_content_word_count ON normalized_content(word_count);

-- Add updated_at triggers
CREATE TRIGGER update_raw_pages_updated_at BEFORE UPDATE ON raw_pages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_claims_updated_at BEFORE UPDATE ON claims
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to find similar content using embeddings
CREATE OR REPLACE FUNCTION find_similar_content(
    p_embedding vector(1536),
    p_brand_id UUID DEFAULT NULL,
    p_source_type TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 10,
    p_similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    id UUID,
    source_type TEXT,
    source_id UUID,
    content TEXT,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.source_type,
        e.source_id,
        e.content,
        1 - (e.embedding <=> p_embedding) AS similarity
    FROM embeddings e
    WHERE (p_brand_id IS NULL OR e.brand_id = p_brand_id)
      AND (p_source_type IS NULL OR e.source_type = p_source_type)
      AND 1 - (e.embedding <=> p_embedding) >= p_similarity_threshold
    ORDER BY e.embedding <=> p_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to extract domain from URL
CREATE OR REPLACE FUNCTION extract_domain(url TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN regexp_replace(
        regexp_replace(url, '^https?://(www\.)?', ''),
        '/.*$', ''
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;