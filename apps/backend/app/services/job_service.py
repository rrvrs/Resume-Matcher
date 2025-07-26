import uuid
import json
import logging

from typing import List, Dict, Any, Optional
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import AgentManager
from app.prompt import prompt_factory
from app.schemas.json import json_schema_factory
from app.models import Job, Resume, ProcessedJob, ProcessingStatus
from app.schemas.pydantic import StructuredJobModel
from .exceptions import (
    JobNotFoundError,
    JobParsingError,
    JobKeywordExtractionError,
)
from .validation_service import ValidationService

logger = logging.getLogger(__name__)


class JobService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.json_agent_manager = AgentManager(model="gemma3:4b")
        self.validation_service = ValidationService(db)

    async def create_and_store_job(self, job_data: dict) -> List[str]:
        """
        Stores job data in the database and returns a list of job IDs.
        """
        resume_id = str(job_data.get("resume_id"))

        if not await self._is_resume_available(resume_id):
            raise AssertionError(
                f"resume corresponding to resume_id: {resume_id} not found"
            )

        job_ids = []
        for job_description in job_data.get("job_descriptions", []):
            job_id = str(uuid.uuid4())
            job = Job(
                job_id=job_id,
                resume_id=str(resume_id),
                content=job_description,
            )
            self.db.add(job)

            await self._extract_and_store_structured_job(
                job_id=job_id, job_description_text=job_description
            )
            logger.info(f"Job ID: {job_id}")
            job_ids.append(job_id)

        await self.db.commit()
        return job_ids

    async def _is_resume_available(self, resume_id: str) -> bool:
        """
        Checks if a resume exists in the database.
        """
        query = select(Resume).where(Resume.resume_id == resume_id)
        result = await self.db.scalar(query)
        return result is not None

    async def _extract_and_store_structured_job(
        self, job_id, job_description_text: str
    ):
        """
        Extract and store structured job data with proper status tracking.
        """
        # Create initial processing record
        processed_job = ProcessedJob(
            job_id=job_id,
            job_title="",  # Temporary placeholder
            job_summary="",  # Temporary placeholder
            extracted_keywords={},  # Temporary empty data
            processing_status=ProcessingStatus.PROCESSING
        )
        
        self.db.add(processed_job)
        await self.db.flush()
        
        try:
            structured_job = await self._extract_structured_json(job_description_text)
            if not structured_job:
                logger.error("Structured job extraction failed.")
                processed_job.processing_status = ProcessingStatus.FAILED
                processed_job.processing_error = "Failed to extract structured data from job description"
                await self.db.commit()
                raise AssertionError(
                    "Failed to extract structured data from job description. Please ensure the job description is clear and contains all necessary sections."
                )

            # Validate using centralized service
            if not self.validation_service.validate_structured_data(structured_job, "job"):
                processed_job.processing_status = ProcessingStatus.FAILED
                processed_job.processing_error = "Job structure validation failed"
                await self.db.commit()
                raise AssertionError(
                    "Failed to extract keywords from job description. Please ensure the job description contains relevant skills and requirements that can be identified."
                )

            # Update with actual data
            processed_job.job_title = structured_job.get("job_title")
            processed_job.company_profile = (
                json.dumps(structured_job.get("company_profile"))
                if structured_job.get("company_profile")
                else None
            )
            processed_job.location = (
                json.dumps(structured_job.get("location"))
                if structured_job.get("location")
                else None
            )
            processed_job.date_posted = structured_job.get("date_posted")
            processed_job.employment_type = structured_job.get("employment_type")
            processed_job.job_summary = structured_job.get("job_summary")
            processed_job.key_responsibilities = (
                json.dumps({"key_responsibilities": structured_job.get("key_responsibilities", [])})
                if structured_job.get("key_responsibilities")
                else None
            )
            processed_job.qualifications = (
                json.dumps({"qualifications": structured_job.get("qualifications", [])})
                if structured_job.get("qualifications")
                else None
            )
            processed_job.compensation_and_benfits = (
                json.dumps({"compensation_and_benfits": structured_job.get("compensation_and_benfits", [])})
                if structured_job.get("compensation_and_benfits")
                else None
            )
            processed_job.application_info = (
                json.dumps({"application_info": structured_job.get("application_info", [])})
                if structured_job.get("application_info")
                else None
            )
            processed_job.extracted_keywords = json.dumps(
                {"extracted_keywords": structured_job.get("extracted_keywords", [])}
            )
            processed_job.processing_status = ProcessingStatus.COMPLETED
            processed_job.processing_error = None
            
            await self.db.commit()
            
        except AssertionError:
            # Re-raise validation errors to propagate to the upload endpoint
            raise
        except Exception as e:
            logger.error(f"Error storing structured job: {str(e)}")
            processed_job.processing_status = ProcessingStatus.FAILED
            processed_job.processing_error = f"Failed to store structured job data: {str(e)}"
            await self.db.commit()
            raise AssertionError(f"Failed to store structured job data: {str(e)}")

        return job_id

    async def _extract_structured_json(
        self, job_description_text: str
    ) -> Dict[str, Any] | None:
        """
        Uses the AgentManager+JSONWrapper to ask the LLM to
        return the data in exact JSON schema we need.
        """
        prompt_template = prompt_factory.get("structured_job")
        prompt = prompt_template.format(
            json.dumps(json_schema_factory.get("structured_job"), indent=2),
            job_description_text,
        )
        logger.info(f"Structured Job Prompt: {prompt}")
        raw_output = await self.json_agent_manager.run(prompt=prompt)

        try:
            structured_job: StructuredJobModel = StructuredJobModel.model_validate(
                raw_output
            )
        except ValidationError as e:
            logger.info(f"Validation error: {e}")
            return None
        return structured_job.model_dump(mode="json")

    async def get_job_with_processed_data(self, job_id: str) -> Optional[Dict]:
        """
        Retrieves combined data from both job and processed_job models.
        Uses validation service for consistency.
        
        Args:
            job_id: The ID of the job to retrieve

        Returns:
            Combined data from both job and processed_job models
        """
        try:
            job, processed_job = await self.validation_service.validate_job_completeness(job_id)
            
            combined_data = {
                "job": {
                    "job_id": job.job_id,
                    "resume_id": job.resume_id,
                    "content": job.content,
                    "created_at": job.created_at.isoformat() if job.created_at else None,
                },
                "processed_job": None,
            }

            if processed_job:
                combined_data["processed_job"] = {
                    "job_title": processed_job.job_title,
                    "company_profile": json.loads(processed_job.company_profile)
                    if processed_job.company_profile
                    else None,
                    "location": json.loads(processed_job.location)
                    if processed_job.location
                    else None,
                    "date_posted": processed_job.date_posted,
                    "employment_type": processed_job.employment_type,
                    "job_summary": processed_job.job_summary,
                    "key_responsibilities": json.loads(
                        processed_job.key_responsibilities
                    ).get("key_responsibilities", [])
                    if processed_job.key_responsibilities
                    else None,
                    "qualifications": json.loads(processed_job.qualifications).get(
                        "qualifications", []
                    )
                    if processed_job.qualifications
                    else None,
                    "compensation_and_benfits": json.loads(
                        processed_job.compensation_and_benfits
                    ).get("compensation_and_benfits", [])
                    if processed_job.compensation_and_benfits
                    else None,
                    "application_info": json.loads(processed_job.application_info).get(
                        "application_info", []
                    )
                    if processed_job.application_info
                    else None,
                    "extracted_keywords": json.loads(processed_job.extracted_keywords).get(
                        "extracted_keywords", []
                    )
                    if processed_job.extracted_keywords
                    else None,
                    "processing_status": processed_job.processing_status.value,
                    "processed_at": processed_job.processed_at.isoformat()
                    if processed_job.processed_at
                    else None,
                }

            return combined_data
            
        except (JobNotFoundError, JobParsingError, JobKeywordExtractionError):
            return None
