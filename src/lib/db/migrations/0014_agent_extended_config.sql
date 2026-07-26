-- Add extended_config column to agent_config for RAG settings
ALTER TABLE agent_config ADD COLUMN extended_config TEXT;
