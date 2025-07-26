CREATE TYPE processing_status AS ENUM ('pending', 'processing', 'completed', 'failed');

ALTER TABLE processed_resumes 
ADD COLUMN processing_status processing_status NOT NULL DEFAULT 'pending',
ADD COLUMN processing_error TEXT;

ALTER TABLE processed_jobs
ADD COLUMN processing_status processing_status NOT NULL DEFAULT 'pending',
ADD COLUMN processing_error TEXT;

UPDATE processed_resumes SET processing_status = 'completed' WHERE extracted_keywords IS NOT NULL;
UPDATE processed_jobs SET processing_status = 'completed' WHERE extracted_keywords IS NOT NULL;

UPDATE processed_resumes SET extracted_keywords = '{"extracted_keywords": []}' WHERE extracted_keywords IS NULL;
UPDATE processed_jobs SET extracted_keywords = '{"extracted_keywords": []}' WHERE extracted_keywords IS NULL;

ALTER TABLE processed_resumes ALTER COLUMN extracted_keywords SET NOT NULL;
ALTER TABLE processed_jobs ALTER COLUMN extracted_keywords SET NOT NULL;

CREATE INDEX idx_processed_resumes_status ON processed_resumes(processing_status);
CREATE INDEX idx_processed_jobs_status ON processed_jobs(processing_status);

CREATE INDEX idx_jobs_job_id ON jobs(job_id); 