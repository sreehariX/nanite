"""
Evaluation service using Perplexity Sonar API and Oumi-style LLM-as-judge methodology.
Uses OpenAI-compatible API for Perplexity.
"""
import os
import json
import asyncio
from pathlib import Path
from typing import Optional
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from openai import OpenAI


class EvalDatasetItem(BaseModel):
    id: str
    diff: str
    expected_focus: str
    description: str


class JudgeResult(BaseModel):
    detected: bool
    reason: Optional[str] = None


class ModelPromptResult(BaseModel):
    model: str
    prompt_id: str
    prompt_content: str
    critical_detection_rate: float
    hallucination_rate: float
    helpfulness_rate: float
    passed: bool
    details: list[dict]


SYSTEM_PROMPTS = [
    {
        "id": "prompt-1",
        "content": "You are an AI code reviewer. Review the following pull request and identify any issues, bugs, or improvements. Be concise and actionable in your feedback."
    },
    {
        "id": "prompt-2",
        "content": """You are an AI assistant that reviews code changes. Analyze the diff provided and point out:
- Potential bugs or errors
- Security concerns
- Performance issues
- Code quality improvements

Provide specific line references where applicable."""
    },
]

EXPECTED_FOCUS_DESCRIPTIONS = {
    "silent_failure": "silent failure or missing error handling when operation fails",
    "null_reference": "null or undefined reference that could cause runtime errors",
    "sql_injection": "SQL injection vulnerability from unsanitized input",
    "duplicate_charge": "risk of duplicate charges or transactions without idempotency",
    "signature_bypass": "webhook or request signature verification being bypassed",
    "weak_crypto": "weak cryptographic practices like MD5 or SHA1 for passwords",
    "auth_bypass": "authentication or authorization check being removed or bypassed",
    "open_redirect": "open redirect vulnerability allowing redirect to external domains",
    "missing_backoff": "missing exponential backoff in retry logic",
    "rate_limit_removed": "rate limiting being removed or disabled",
    "path_traversal": "path traversal vulnerability allowing access to arbitrary files",
    "hardcoded_secret": "hardcoded secrets or credentials in source code",
    "error_disclosure": "sensitive error information being exposed to clients",
    "race_condition": "race condition in concurrent operations",
    "missing_timeout": "missing timeout on external calls that could hang",
    "missing_audit": "missing audit logging for sensitive operations"
}


class EvalService:
    """
    Oumi-style evaluation service using Perplexity Sonar API.
    Implements LLM-as-judge methodology for PR review evaluation.
    """
    
    def __init__(self):
        api_key = os.getenv("PERPLEXITY_API_KEY")
        if not api_key:
            raise ValueError("PERPLEXITY_API_KEY environment variable required")
        
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://api.perplexity.ai"
        )
        
        self.models = [
            "sonar",
            "sonar-pro",
        ]
        
        self.judge_model = "sonar"
        self.dataset = self._load_dataset()
    
    def generate_expected_focus(self, diff: str, title: str) -> dict:
        """
        Analyze a PR diff and generate the expected focus area for evaluation.
        Returns a focus keyword and explanation.
        """
        prompt = f"""Analyze this pull request and determine what a code reviewer should focus on.

PR Title: {title}

Diff:
```
{diff[:3000]}
```

Based on the changes, identify the PRIMARY area a code reviewer should focus on.
Choose ONE focus area from this list that best matches:
- error_handling: Missing or improper error handling
- null_check: Potential null/undefined reference issues  
- security_vulnerability: Security issues like injection, auth bypass
- performance_issue: Performance problems or inefficiencies
- race_condition: Concurrency or race condition issues
- memory_leak: Resource or memory leaks
- input_validation: Missing input validation
- authentication: Authentication or authorization issues
- data_integrity: Data consistency or integrity issues
- logging: Missing or improper logging
- edge_case: Unhandled edge cases
- type_safety: Type-related issues
- api_contract: API contract violations
- configuration: Configuration or environment issues
- refactoring: Code quality improvements needed

Respond with ONLY valid JSON:
{{"focus": "chosen_focus_keyword", "explanation": "brief reason why this is the main concern"}}"""

        try:
            response = self.client.chat.completions.create(
                model=self.judge_model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=256,
                temperature=0.1,
            )
            
            text = response.choices[0].message.content or ""
            if "```" in text:
                text = text.split("```")[1] if "```" in text else text
                if text.startswith("json"):
                    text = text[4:]
            
            data = json.loads(text.strip())
            return {
                "focus": data.get("focus", "code_quality"),
                "explanation": data.get("explanation", "General code review")
            }
        except Exception as e:
            return {
                "focus": "code_quality",
                "explanation": f"Could not analyze: {str(e)}"
            }
    
    def _load_dataset(self) -> list[EvalDatasetItem]:
        dataset_path = Path(__file__).parent.parent / "data" / "global_eval_dataset.json"
        with open(dataset_path) as f:
            data = json.load(f)
        return [EvalDatasetItem(**item) for item in data]
    
    def run_candidate_model(self, model_name: str, system_prompt: str, diff: str) -> str:
        """Generate a code review using Perplexity Sonar API."""
        try:
            user_content = f"PR Diff:\n```\n{diff}\n```\n\nProvide your code review:"
            
            response = self.client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content}
                ],
                max_tokens=1024,
                temperature=0.3,
            )
            return response.choices[0].message.content or "No response generated"
        except Exception as e:
            return f"Error generating review: {str(e)}"
    
    def _parse_judge_response(self, response_text: str) -> tuple[bool, Optional[str]]:
        """Parse judge response to extract boolean judgment and reason."""
        text = response_text.strip().lower()
        
        # Try to parse JSON first
        try:
            # Clean up markdown code blocks if present
            if "```" in text:
                text = text.split("```")[1] if "```" in text else text
                if text.startswith("json"):
                    text = text[4:]
            
            data = json.loads(text)
            detected = data.get("judgment", data.get("detected", False))
            reason = data.get("reason", data.get("explanation", None))
            return bool(detected), reason
        except:
            pass
        
        # Fallback to text parsing
        if text.startswith("yes") or "yes" in text[:20]:
            return True, None
        elif text.startswith("no") or "no" in text[:20]:
            return False, response_text if len(response_text) > 10 else None
        
        # Default
        return False, f"Could not parse: {response_text[:100]}"
    
    def judge_critical_detection(self, diff: str, review: str, expected_focus: str) -> JudgeResult:
        """
        Oumi-style LLM judge for critical issue detection.
        Uses binary classification (BOOL judgment type).
        """
        focus_description = EXPECTED_FOCUS_DESCRIPTIONS.get(expected_focus, expected_focus)
        
        judge_prompt = f"""You are a strict evaluator. Determine if a code review correctly identified a specific issue.

PR Diff:
```
{diff}
```

Code Review Output:
```
{review}
```

Question: Did the review correctly identify the risk of {focus_description.upper()}?

The review doesn't need to use the exact words, but must clearly mention or describe this type of issue.

Respond with ONLY valid JSON: {{"judgment": true}} or {{"judgment": false, "reason": "brief explanation"}}"""

        try:
            response = self.client.chat.completions.create(
                model=self.judge_model,
                messages=[{"role": "user", "content": judge_prompt}],
                max_tokens=256,
                temperature=0.0,
            )
            detected, reason = self._parse_judge_response(response.choices[0].message.content or "")
            return JudgeResult(detected=detected, reason=reason if not detected else None)
        except Exception as e:
            return JudgeResult(detected=False, reason=f"Judge error: {str(e)}")
    
    def judge_hallucination(self, diff: str, review: str) -> JudgeResult:
        """
        Oumi-style LLM judge for hallucination detection.
        Uses binary classification (BOOL judgment type).
        """
        judge_prompt = f"""You are a strict evaluator checking for hallucinations in code reviews.

PR Diff:
```
{diff}
```

Code Review Output:
```
{review}
```

Question: Did the review mention issues that are NOT present in the diff?
(e.g., mentioning SQL injection when there's no database code, mentioning authentication when there's no auth code)

Respond with ONLY valid JSON: {{"judgment": true, "reason": "what was hallucinated"}} or {{"judgment": false}}"""

        try:
            response = self.client.chat.completions.create(
                model=self.judge_model,
                messages=[{"role": "user", "content": judge_prompt}],
                max_tokens=256,
                temperature=0.0,
            )
            detected, reason = self._parse_judge_response(response.choices[0].message.content or "")
            return JudgeResult(detected=detected, reason=reason if detected else None)
        except Exception as e:
            return JudgeResult(detected=False, reason=f"Judge error: {str(e)}")
    
    def judge_helpfulness(self, review: str) -> JudgeResult:
        """
        Oumi-style LLM judge for helpfulness evaluation.
        Uses binary classification (BOOL judgment type).
        """
        judge_prompt = f"""You are evaluating if a code review is helpful.

Code Review Output:
```
{review}
```

Question: Did the review provide at least one concrete, actionable suggestion for improvement?

Respond with ONLY valid JSON: {{"judgment": true}} or {{"judgment": false, "reason": "why not helpful"}}"""

        try:
            response = self.client.chat.completions.create(
                model=self.judge_model,
                messages=[{"role": "user", "content": judge_prompt}],
                max_tokens=256,
                temperature=0.0,
            )
            detected, reason = self._parse_judge_response(response.choices[0].message.content or "")
            return JudgeResult(detected=detected, reason=reason if not detected else None)
        except Exception as e:
            return JudgeResult(detected=False, reason=f"Judge error: {str(e)}")
    
    def evaluate_single_pr(self, model_name: str, prompt: dict, pr: EvalDatasetItem) -> dict:
        """Evaluate a single PR using LLM-as-judge methodology."""
        review = self.run_candidate_model(model_name, prompt["content"], pr.diff)
        
        critical_result = self.judge_critical_detection(pr.diff, review, pr.expected_focus)
        hallucination_result = self.judge_hallucination(pr.diff, review)
        helpfulness_result = self.judge_helpfulness(review)
        
        return {
            "pr_id": pr.id,
            "expected_focus": pr.expected_focus,
            "review": review[:500] + "..." if len(review) > 500 else review,
            "critical_detected": critical_result.detected,
            "hallucinated": hallucination_result.detected,
            "helpful": helpfulness_result.detected,
            "critical_reason": critical_result.reason,
            "hallucination_reason": hallucination_result.reason,
        }
    
    def evaluate_model_prompt_combination(self, model_name: str, prompt: dict) -> ModelPromptResult:
        """Evaluate all PRs for a model/prompt combination."""
        results = []
        for pr in self.dataset:
            result = self.evaluate_single_pr(model_name, prompt, pr)
            results.append(result)
        
        n = len(results)
        critical_detection_rate = sum(1 for r in results if r["critical_detected"]) / n
        hallucination_rate = sum(1 for r in results if r["hallucinated"]) / n
        helpfulness_rate = sum(1 for r in results if r["helpful"]) / n
        
        # Pass criteria: >50% critical detection, <35% hallucination
        passed = critical_detection_rate >= 0.5 and hallucination_rate <= 0.35
        
        return ModelPromptResult(
            model=model_name,
            prompt_id=prompt["id"],
            prompt_content=prompt["content"],
            critical_detection_rate=critical_detection_rate,
            hallucination_rate=hallucination_rate,
            helpfulness_rate=helpfulness_rate,
            passed=passed,
            details=results
        )
    
    async def run_global_evaluation(self) -> list[ModelPromptResult]:
        """Run global evaluation across all models and prompts."""
        results = []
        
        for model in self.models:
            for prompt in SYSTEM_PROMPTS:
                try:
                    result = await asyncio.to_thread(
                        self.evaluate_model_prompt_combination, model, prompt
                    )
                    results.append(result)
                except Exception as e:
                    results.append(ModelPromptResult(
                        model=model,
                        prompt_id=prompt["id"],
                        prompt_content=prompt["content"],
                        critical_detection_rate=0,
                        hallucination_rate=1,
                        helpfulness_rate=0,
                        passed=False,
                        details=[{"error": str(e)}]
                    ))
        
        return results


# Initialize service
eval_service = EvalService()
