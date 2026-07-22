-- Schema definition for BlackBox AI

CREATE TABLE IF NOT EXISTS investigations (
    id VARCHAR(50) PRIMARY KEY,
    title TEXT NOT NULL,
    agent_name VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'completed', 'degraded', 'failed'
    duration_ms INT NOT NULL DEFAULT 0,
    cost NUMERIC(10, 6) NOT NULL DEFAULT 0.0,
    total_tokens INT NOT NULL DEFAULT 0,
    error_count INT NOT NULL DEFAULT 0,
    retry_count INT NOT NULL DEFAULT 0,
    summary TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS execution_events (
    id VARCHAR(50) PRIMARY KEY,
    trace_id VARCHAR(50) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- 'NODE_STARTED', 'NODE_COMPLETED', 'TOKEN_STREAM', 'ERROR', 'RETRY', 'FINISHED'
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS investigation_reports (
    id VARCHAR(50) PRIMARY KEY,
    trace_id VARCHAR(50) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    executive_summary TEXT NOT NULL,
    root_cause TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    optimization_opportunities JSONB NOT NULL DEFAULT '[]'::jsonb,
    estimated_savings JSONB NOT NULL DEFAULT '{}'::jsonb,
    recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    prompt_version VARCHAR(50) NOT NULL DEFAULT 'v1.0',
    investigation_context JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_execution_events_trace_id ON execution_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_investigation_reports_trace_id ON investigation_reports(trace_id);
