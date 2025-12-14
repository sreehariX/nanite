"""
Evaluation service using Oumi LLM-as-judge framework with Perplexity models.
"""
import os
import json
from pathlib import Path
from typing import Optional, Any
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from openai import OpenAI

# Oumi imports for LLM-as-judge functionality
from oumi.judges.simple_judge import SimpleJudge
from oumi.core.configs.judge_config import JudgeConfig


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
    }
    
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


class OumiJudge:
    """
    LLM Judge using Oumi framework with Perplexity Sonar API.
    Implements BOOL judgment type with explanation support.
    """
    
    def __init__(self):
        judges_dir = Path(__file__).parent.parent / "judges"
        
        # Load Oumi judge configurations from YAML files
        self.critical_judge = SimpleJudge(
            judge_config=str(judges_dir / "critical_detection.yaml")
        )
        self.hallucination_judge = SimpleJudge(
            judge_config=str(judges_dir / "hallucination.yaml")
        )
        self.helpfulness_judge = SimpleJudge(
            judge_config=str(judges_dir / "helpfulness.yaml")
        )
    
    def judge_critical_detection(self, diff: str, review: str, expected_focus: str) -> JudgeResult:
        """
        Oumi BOOL judgment for critical issue detection.
        Uses SimpleJudge with the critical_detection.yaml configuration.
        """
        try:
            # Prepare dataset for Oumi judge
            dataset = [{
                "diff": diff[:2000],
                "review": review[:2000],
                "expected_focus": expected_focus,
            }]
            
            # Run Oumi judge
            outputs = self.critical_judge.judge(dataset)
            
            if outputs and len(outputs) > 0:
                output = outputs[0]
                judgment = output.field_values.get("judgment", False)
                explanation = output.field_values.get("explanation")
                
                # Convert judgment to boolean if it's a string
                if isinstance(judgment, str):
                    judgment = judgment.lower() in ["yes", "true", "1"]
                
                return JudgeResult(
                    detected=bool(judgment),
                    reason=explanation if not judgment else None
                )
            
            return JudgeResult(detected=False, reason="No judgment output from Oumi")
            
        except Exception as e:
            return JudgeResult(detected=False, reason=f"Oumi judge error: {str(e)}")
    
    def judge_hallucination(self, diff: str, review: str) -> JudgeResult:
        """
        Oumi BOOL judgment for hallucination detection.
        Uses SimpleJudge with the hallucination.yaml configuration.
        """
        try:
            # Prepare dataset for Oumi judge
            dataset = [{
                "diff": diff[:2000],
                "review": review[:2000],
            }]
            
            # Run Oumi judge
            outputs = self.hallucination_judge.judge(dataset)
            
            if outputs and len(outputs) > 0:
                output = outputs[0]
                judgment = output.field_values.get("judgment", False)
                explanation = output.field_values.get("explanation")
                
                # Convert judgment to boolean if it's a string
                if isinstance(judgment, str):
                    judgment = judgment.lower() in ["yes", "true", "1"]
                
                return JudgeResult(
                    detected=bool(judgment),
                    reason=explanation if judgment else None
                )
            
            return JudgeResult(detected=False, reason="No judgment output from Oumi")
            
        except Exception as e:
            return JudgeResult(detected=False, reason=f"Oumi judge error: {str(e)}")
    
    def judge_helpfulness(self, review: str) -> JudgeResult:
        """
        Oumi BOOL judgment for helpfulness.
        Uses SimpleJudge with the helpfulness.yaml configuration.
        """
        try:
            # Prepare dataset for Oumi judge
            dataset = [{
                "review": review[:2000],
            }]
            
            # Run Oumi judge
            outputs = self.helpfulness_judge.judge(dataset)
            
            if outputs and len(outputs) > 0:
                output = outputs[0]
                judgment = output.field_values.get("judgment", False)
                explanation = output.field_values.get("explanation")
                
                # Convert judgment to boolean if it's a string
                if isinstance(judgment, str):
                    judgment = judgment.lower() in ["yes", "true", "1"]
                
                return JudgeResult(
                    detected=bool(judgment),
                    reason=explanation if not judgment else None
                )
            
            return JudgeResult(detected=False, reason="No judgment output from Oumi")
            
        except Exception as e:
            return JudgeResult(detected=False, reason=f"Oumi judge error: {str(e)}")


class EvalService:
    """
    Oumi-based evaluation service using Perplexity Sonar models.
    Uses Oumi's SimpleJudge for LLM-as-judge evaluations.
    """
    
    def __init__(self):
        api_key = os.getenv("PERPLEXITY_API_KEY")
        if not api_key:
            raise ValueError("PERPLEXITY_API_KEY environment variable required")
        
        # OpenAI client for generating candidate model reviews
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://api.perplexity.ai"
        )
        
        self.models = [
            "sonar",
            "sonar-pro",
        ]
        
        # Use Oumi judge for evaluations
        self.judge = OumiJudge()
        self.dataset = self._load_dataset()
    
    def _load_dataset(self) -> list[EvalDatasetItem]:
        dataset_path = Path(__file__).parent.parent / "data" / "global_eval_dataset.json"
        with open(dataset_path) as f:
            data = json.load(f)
        return [EvalDatasetItem(**item) for item in data]
    
    def run_candidate_model(self, model_name: str, system_prompt: str, diff: str) -> str:
        """Generate a code review using Perplexity Sonar API."""
        try:
            response = self.client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"PR Diff:\n```\n{diff}\n```\n\nProvide your code review:"}
                ],
                max_tokens=1024,
                temperature=0.3,
            )
            return response.choices[0].message.content or "No response generated"
        except Exception as e:
            return f"Error generating review: {str(e)}"
    
    def generate_expected_focus(self, diff: str, title: str) -> dict:
        """Analyze a PR diff and generate the expected focus area."""
        prompt = f"""Analyze this pull request and determine what a code reviewer should focus on.

PR Title: {title}

Diff:
```
{diff[:3000]}
```

Choose ONE focus area:
error_handling, null_check, security_vulnerability, performance_issue, race_condition, memory_leak, input_validation, authentication, data_integrity, logging, edge_case, type_safety, api_contract, configuration, refactoring

Respond with JSON: {{"focus": "chosen_focus", "explanation": "brief reason"}}"""

        try:
            response = self.client.chat.completions.create(
                model="sonar",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=256,
                temperature=0.1,
            )
            
            text = response.choices[0].message.content or ""
            if "```" in text:
                for part in text.split("```"):
                    if "{" in part:
                        text = part.replace("json", "").strip()
                        break
            
            data = json.loads(text.strip())
            return {
                "focus": data.get("focus", "code_quality"),
                "explanation": data.get("explanation", "General code review")
            }
        except Exception as e:
            return {"focus": "code_quality", "explanation": f"Could not analyze: {str(e)}"}
    
    def judge_critical_detection(self, diff: str, review: str, expected_focus: str) -> JudgeResult:
        """Use Oumi judge for critical issue detection."""
        focus_description = EXPECTED_FOCUS_DESCRIPTIONS.get(expected_focus, expected_focus)
        return self.judge.judge_critical_detection(diff, review, focus_description)
    
    def judge_hallucination(self, diff: str, review: str) -> JudgeResult:
        """Use Oumi judge for hallucination detection."""
        return self.judge.judge_hallucination(diff, review)
    
    def judge_helpfulness(self, review: str) -> JudgeResult:
        """Use Oumi judge for helpfulness evaluation."""
        return self.judge.judge_helpfulness(review)
    
    def evaluate_single_pr(self, model_name: str, prompt: dict, pr: EvalDatasetItem) -> dict:
        """Evaluate a single PR using Oumi LLM-as-judge."""
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
        """Evaluate all PRs for a model/prompt combination using Oumi judges."""
        results = []
        for pr in self.dataset:
            result = self.evaluate_single_pr(model_name, prompt, pr)
            results.append(result)
        
        n = len(results)
        critical_detection_rate = sum(1 for r in results if r["critical_detected"]) / n
        hallucination_rate = sum(1 for r in results if r["hallucinated"]) / n
        helpfulness_rate = sum(1 for r in results if r["helpful"]) / n
        
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


eval_service = EvalService()
