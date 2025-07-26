import gc
import json
import asyncio
import logging
import markdown
import numpy as np

from sqlalchemy.future import select
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Optional, Tuple, AsyncGenerator

from app.prompt import prompt_factory
from app.schemas.json import json_schema_factory
from app.schemas.pydantic import ResumePreviewerModel
from app.agent import EmbeddingManager, AgentManager
from app.models import Resume, Job, ProcessedResume, ProcessedJob
from .exceptions import (
    ResumeNotFoundError,
    JobNotFoundError,
    ResumeParsingError,
    JobParsingError,
    ResumeKeywordExtractionError,
    JobKeywordExtractionError,
)
from .validation_service import ValidationService

logger = logging.getLogger(__name__)


class ScoreImprovementService:
    """
    Service to handle scoring of resumes and jobs using embeddings.
    Now uses centralized validation for production quality.
    Fetches Resume and Job data from the database, computes embeddings,
    and calculates cosine similarity scores. Uses LLM for iteratively improving
    the scoring process.
    """

    def __init__(self, db: AsyncSession, max_retries: int = 5):
        self.db = db
        self.max_retries = max_retries
        self.md_agent_manager = AgentManager(strategy="md")
        self.json_agent_manager = AgentManager()
        self.embedding_manager = EmbeddingManager()
        self.validation_service = ValidationService(db)

    async def _get_resume(self, resume_id: str) -> Tuple[Resume, ProcessedResume]:
        """
        Fetches and validates resume using centralized validation service.
        """
        return await self.validation_service.validate_resume_completeness(resume_id)

    async def _get_job(self, job_id: str) -> Tuple[Job, ProcessedJob]:
        """
        Fetches and validates job using centralized validation service.
        """
        return await self.validation_service.validate_job_completeness(job_id)

    def calculate_cosine_similarity(
        self,
        extracted_job_keywords_embedding: np.ndarray,
        resume_embedding: np.ndarray,
    ) -> float:
        """
        Calculates the cosine similarity between two embeddings.
        """
        if resume_embedding is None or extracted_job_keywords_embedding is None:
            return 0.0

        ejk = np.asarray(extracted_job_keywords_embedding).squeeze()
        re = np.asarray(resume_embedding).squeeze()

        return float(np.dot(ejk, re) / (np.linalg.norm(ejk) * np.linalg.norm(re)))

    async def improve_score_with_llm(
        self,
        resume: str,
        extracted_resume_keywords: str,
        job: str,
        extracted_job_keywords: str,
        previous_cosine_similarity_score: float,
        extracted_job_keywords_embedding: np.ndarray,
    ) -> Tuple[str, float]:
        prompt_template = prompt_factory.get("resume_improvement")
        best_resume, best_score = resume, previous_cosine_similarity_score

        for attempt in range(1, self.max_retries + 1):
            logger.info(
                f"Attempt {attempt}/{self.max_retries} to improve resume score."
            )
            prompt = prompt_template.format(
                raw_job_description=job,
                extracted_job_keywords=extracted_job_keywords,
                raw_resume=best_resume,
                extracted_resume_keywords=extracted_resume_keywords,
                current_cosine_similarity=best_score,
            )
            improved = await self.md_agent_manager.run(prompt)
            emb = await self.embedding_manager.embed(text=improved)
            score = self.calculate_cosine_similarity(
                emb, extracted_job_keywords_embedding
            )

            if score > best_score:
                return improved, score

            logger.info(
                f"Attempt {attempt} did not improve score. Current: {score:.4f}, Best: {best_score:.4f}"
            )

        return best_resume, best_score

    async def get_resume_for_previewer(self, updated_resume: str) -> Optional[Dict]:
        """
        Get resume preview data for display.
        """
        prompt_template = prompt_factory.get("resume_preview")
        prompt = prompt_template.format(
            json.dumps(json_schema_factory.get("resume_preview"), indent=2),
            updated_resume,
        )
        raw_output = await self.json_agent_manager.run(prompt=prompt)

        try:
            resume_preview: ResumePreviewerModel = ResumePreviewerModel.model_validate(
                raw_output
            )
        except ValidationError as e:
            logger.info(f"Validation error: {e}")
            return None
        return resume_preview.model_dump()

    async def run(self, resume_id: str, job_id: str) -> Dict:
        """
        Main method to run the scoring and improving process.
        Uses centralized validation for production quality.
        """
        # Get validated data
        resume, processed_resume = await self._get_resume(resume_id)
        job, processed_job = await self._get_job(job_id)

        # Extract keywords safely (validation service already checked these)
        job_keywords_data = json.loads(processed_job.extracted_keywords)
        extracted_job_keywords = ", ".join(
            job_keywords_data.get("extracted_keywords", [])
        )

        resume_keywords_data = json.loads(processed_resume.extracted_keywords)
        extracted_resume_keywords = ", ".join(
            resume_keywords_data.get("extracted_keywords", [])
        )

        resume_embedding_task = asyncio.create_task(
            self.embedding_manager.embed(resume.content)
        )
        job_kw_embedding_task = asyncio.create_task(
            self.embedding_manager.embed(extracted_job_keywords)
        )
        resume_embedding, extracted_job_keywords_embedding = await asyncio.gather(
            resume_embedding_task, job_kw_embedding_task
        )

        cosine_similarity_score = self.calculate_cosine_similarity(
            extracted_job_keywords_embedding, resume_embedding
        )
        updated_resume, updated_score = await self.improve_score_with_llm(
            resume=resume.content,
            extracted_resume_keywords=extracted_resume_keywords,
            job=job.content,
            extracted_job_keywords=extracted_job_keywords,
            previous_cosine_similarity_score=cosine_similarity_score,
            extracted_job_keywords_embedding=extracted_job_keywords_embedding,
        )

        resume_preview = await self.get_resume_for_previewer(
            updated_resume=updated_resume
        )

        logger.info(f"Resume Preview: {resume_preview}")

        execution = {
            "resume_id": resume_id,
            "job_id": job_id,
            "original_score": cosine_similarity_score,
            "new_score": updated_score,
            "updated_resume": markdown.markdown(text=updated_resume),
            "resume_preview": resume_preview,
        }

        gc.collect()
        return execution

    async def run_and_stream(self, resume_id: str, job_id: str) -> AsyncGenerator:
        """
        Streaming version with centralized validation.
        """
        yield f"data: {json.dumps({'status': 'starting', 'message': 'Validating data completeness...'})}\n\n"
        await asyncio.sleep(1)

        try:
            resume, processed_resume = await self._get_resume(resume_id)
            job, processed_job = await self._get_job(job_id)
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'message': f'Validation failed: {str(e)}'})}\n\n"
            return

        yield f"data: {json.dumps({'status': 'parsing', 'message': 'Parsing resume content...'})}\n\n"
        await asyncio.sleep(2)

        job_keywords_data = json.loads(processed_job.extracted_keywords)
        extracted_job_keywords = ", ".join(
            job_keywords_data.get("extracted_keywords", [])
        )

        resume_keywords_data = json.loads(processed_resume.extracted_keywords)
        extracted_resume_keywords = ", ".join(
            resume_keywords_data.get("extracted_keywords", [])
        )

        resume_embedding = await self.embedding_manager.embed(text=resume.content)
        extracted_job_keywords_embedding = await self.embedding_manager.embed(
            text=extracted_job_keywords
        )

        yield f"data: {json.dumps({'status': 'scoring', 'message': 'Calculating compatibility score...'})}\n\n"
        await asyncio.sleep(3)

        cosine_similarity_score = self.calculate_cosine_similarity(
            extracted_job_keywords_embedding, resume_embedding
        )

        yield f"data: {json.dumps({'status': 'improving', 'message': 'Improving resume content...'})}\n\n"
        await asyncio.sleep(2)

        updated_resume, updated_score = await self.improve_score_with_llm(
            resume=resume.content,
            extracted_resume_keywords=extracted_resume_keywords,
            job=job.content,
            extracted_job_keywords=extracted_job_keywords,
            previous_cosine_similarity_score=cosine_similarity_score,
            extracted_job_keywords_embedding=extracted_job_keywords_embedding,
        )

        yield f"data: {json.dumps({'status': 'generating', 'message': 'Generating preview...'})}\n\n"
        await asyncio.sleep(2)

        resume_preview = await self.get_resume_for_previewer(
            updated_resume=updated_resume
        )

        execution = {
            "resume_id": resume_id,
            "job_id": job_id,
            "original_score": cosine_similarity_score,
            "new_score": updated_score,
            "updated_resume": markdown.markdown(text=updated_resume),
            "resume_preview": resume_preview,
        }

        yield f"data: {json.dumps({'status': 'completed', 'data': execution})}\n\n"

        gc.collect()
