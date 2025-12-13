import os
import re
import httpx
from typing import Optional


class GitHubService:
    def __init__(self, token: Optional[str] = None):
        self.token = token or os.getenv("GITHUB_TOKEN")
        self.base_url = "https://api.github.com"
        self.headers = {
            "Accept": "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            self.headers["Authorization"] = f"Bearer {self.token}"

    def parse_repo_url(self, url: str) -> tuple[str, str]:
        patterns = [
            r"github\.com[/:]([^/]+)/([^/\.]+)",
            r"^([^/]+)/([^/]+)$",
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1), match.group(2).replace(".git", "")
        raise ValueError(f"Invalid GitHub URL: {url}")

    async def get_closed_prs(self, repo_url: str, limit: int = 20) -> dict:
        owner, repo = self.parse_repo_url(repo_url)

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/repos/{owner}/{repo}/pulls",
                headers=self.headers,
                params={
                    "state": "closed",
                    "sort": "updated",
                    "direction": "desc",
                    "per_page": limit,
                },
            )
            response.raise_for_status()
            prs_data = response.json()

            prs = []
            for pr in prs_data:
                diff = await self._get_pr_diff(client, owner, repo, pr["number"])
                prs.append({
                    "id": pr["number"],
                    "title": pr["title"],
                    "diff": diff,
                    "url": pr["html_url"],
                    "merged": pr.get("merged_at") is not None,
                    "author": pr["user"]["login"],
                    "created_at": pr["created_at"],
                    "closed_at": pr["closed_at"],
                })

            return {
                "repo": f"{owner}/{repo}",
                "owner": owner,
                "repo_name": repo,
                "prs": prs,
            }

    async def _get_pr_diff(
        self, client: httpx.AsyncClient, owner: str, repo: str, pr_number: int
    ) -> str:
        diff_headers = {**self.headers, "Accept": "application/vnd.github.v3.diff"}
        response = await client.get(
            f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}",
            headers=diff_headers,
        )
        if response.status_code == 200:
            diff = response.text
            if len(diff) > 10000:
                diff = diff[:10000] + "\n... (truncated)"
            return diff
        return ""


github_service = GitHubService()

