"""
Centralized validation service for production-quality data validation.
Provides consistent validation logic across all services.
"""
import json
import logging
from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models import Resume, ProcessedResume, Job, ProcessedJob, ProcessingStatus
from .exceptions import (
    ResumeNotFoundError,
    JobNotFoundError,
    ResumeParsingError,
    JobParsingError,
    ResumeKeywordExtractionError,
    JobKeywordExtractionError,
    ResumeValidationError,
)

logger = logging.getLogger(__name__)


class ValidationService:
    """Centralized validation service for data completeness and integrity."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def validate_resume_completeness(self, resume_id: str) -> Tuple[Resume, ProcessedResume]:
        """
        Validates that a resume exists and has complete processed data.
        
        Returns:
            Tuple of (Resume, ProcessedResume) if valid
            
        Raises:
            ResumeNotFoundError: If resume doesn't exist
            ResumeParsingError: If processed resume doesn't exist
            ResumeKeywordExtractionError: If keywords are missing/invalid
        """
        # Check raw resume exists
        query = select(Resume).where(Resume.resume_id == resume_id)
        result = await self.db.execute(query)
        resume = result.scalars().first()
        
        if not resume:
            raise ResumeNotFoundError(resume_id=resume_id)
        
        # Check processed resume exists
        query = select(ProcessedResume).where(ProcessedResume.resume_id == resume_id)
        result = await self.db.execute(query)
        processed_resume = result.scalars().first()
        
        if not processed_resume:
            raise ResumeParsingError(resume_id=resume_id)
        
        # Check processing status
        if processed_resume.processing_status == ProcessingStatus.FAILED:
            raise ResumeParsingError(
                resume_id=resume_id,
                message=f"Resume processing failed: {processed_resume.processing_error}"
            )
        
        if processed_resume.processing_status != ProcessingStatus.COMPLETED:
            raise ResumeParsingError(
                resume_id=resume_id,
                message=f"Resume processing is not complete. Status: {processed_resume.processing_status.value}"
            )
        
        # Validate keywords
        self._validate_keywords_data(
            processed_resume.extracted_keywords,
            resume_id,
            "resume"
        )
        
        return resume, processed_resume
    
    async def validate_job_completeness(self, job_id: str) -> Tuple[Job, ProcessedJob]:
        """
        Validates that a job exists and has complete processed data.
        
        Returns:
            Tuple of (Job, ProcessedJob) if valid
            
        Raises:
            JobNotFoundError: If job doesn't exist
            JobParsingError: If processed job doesn't exist
            JobKeywordExtractionError: If keywords are missing/invalid
        """
        # Check raw job exists
        query = select(Job).where(Job.job_id == job_id)
        result = await self.db.execute(query)
        job = result.scalars().first()
        
        if not job:
            raise JobNotFoundError(job_id=job_id)
        
        # Check processed job exists
        query = select(ProcessedJob).where(ProcessedJob.job_id == job_id)
        result = await self.db.execute(query)
        processed_job = result.scalars().first()
        
        if not processed_job:
            raise JobParsingError(job_id=job_id)
        
        # Check processing status
        if processed_job.processing_status == ProcessingStatus.FAILED:
            raise JobParsingError(
                job_id=job_id,
                message=f"Job processing failed: {processed_job.processing_error}"
            )
        
        if processed_job.processing_status != ProcessingStatus.COMPLETED:
            raise JobParsingError(
                job_id=job_id,
                message=f"Job processing is not complete. Status: {processed_job.processing_status.value}"
            )
        
        # Validate keywords
        self._validate_keywords_data(
            processed_job.extracted_keywords,
            job_id,
            "job"
        )
        
        return job, processed_job
    
    def _validate_keywords_data(self, keywords_json: str, entity_id: str, entity_type: str) -> List[str]:
        """
        Validates keyword extraction data.
        
        Args:
            keywords_json: JSON string containing keywords
            entity_id: ID of the entity (resume_id or job_id)
            entity_type: "resume" or "job"
            
        Returns:
            List of extracted keywords
            
        Raises:
            ResumeKeywordExtractionError or JobKeywordExtractionError
        """
        if not keywords_json:
            if entity_type == "resume":
                raise ResumeKeywordExtractionError(resume_id=entity_id)
            else:
                raise JobKeywordExtractionError(job_id=entity_id)
        
        try:
            keywords_data = json.loads(keywords_json)
            if keywords_data is None:
                if entity_type == "resume":
                    raise ResumeKeywordExtractionError(resume_id=entity_id)
                else:
                    raise JobKeywordExtractionError(job_id=entity_id)
            
            keywords = keywords_data.get("extracted_keywords", [])
            if not keywords or len(keywords) == 0:
                if entity_type == "resume":
                    raise ResumeKeywordExtractionError(resume_id=entity_id)
                else:
                    raise JobKeywordExtractionError(job_id=entity_id)
            
            return keywords
            
        except json.JSONDecodeError:
            if entity_type == "resume":
                raise ResumeKeywordExtractionError(resume_id=entity_id)
            else:
                raise JobKeywordExtractionError(job_id=entity_id)
    
    async def validate_improvement_readiness(self, resume_id: str, job_id: str) -> Dict[str, Any]:
        """
        Validates that both resume and job are ready for improvement process.
        
        Returns:
            Dict with validation results and data
        """
        try:
            resume, processed_resume = await self.validate_resume_completeness(resume_id)
            job, processed_job = await self.validate_job_completeness(job_id)
            
            return {
                "valid": True,
                "resume": resume,
                "processed_resume": processed_resume,
                "job": job,
                "processed_job": processed_job,
                "message": "Both resume and job data are ready for improvement"
            }
            
        except Exception as e:
            return {
                "valid": False,
                "error": str(e),
                "message": str(e)
            }
    
    def validate_structured_data(self, structured_data: Dict[str, Any], data_type: str) -> bool:
        """
        Validates that structured data contains required fields.
        
        Args:
            structured_data: The structured data to validate
            data_type: "resume" or "job"
            
        Returns:
            True if valid, raises exception if not
        """
        if not structured_data:
            return False
        
        if data_type == "resume":
            required_fields = ["personal_data", "extracted_keywords"]
            for field in required_fields:
                if field not in structured_data or not structured_data[field]:
                    return False
        
        elif data_type == "job":
            required_fields = ["job_title", "job_summary", "extracted_keywords"]
            for field in required_fields:
                if field not in structured_data or not structured_data[field]:
                    return False
        
        # Validate keywords specifically
        keywords = structured_data.get("extracted_keywords", [])
        if not keywords or len(keywords) == 0:
            return False
        
        return True 