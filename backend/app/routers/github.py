from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.github_service import github_service

router = APIRouter(tags=["github"])


class RepoRequest(BaseModel):
    repo_url: str
    limit: int = 20


class PRData(BaseModel):
    id: int
    title: str
    diff: str
    url: str
    merged: bool
    author: str
    created_at: str
    closed_at: str


class PRsResponse(BaseModel):
    repo: str
    owner: str
    repo_name: str
    prs: list[PRData]


@router.post("/prs", response_model=PRsResponse)
async def get_prs(request: RepoRequest):
    try:
        result = await github_service.get_closed_prs(request.repo_url, request.limit)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch PRs: {str(e)}")

