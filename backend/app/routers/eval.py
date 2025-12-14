from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List
import asyncio
import logging
from app.services.eval_service import eval_service, SYSTEM_PROMPTS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(tags=["evaluation"])

eval_results_cache: dict = {}
eval_status: dict = {
    "running": False, 
    "progress": 0, 
    "total": 0, 
    "current_model": "",
    "current_prompt": "",
    "current_pr": "",
    "current_step": "",
    "logs": []
}


def add_log(message: str):
    """Add a log message to the status."""
    logger.info(message)
    eval_status["logs"].append(message)
    # Keep only last 50 logs
    if len(eval_status["logs"]) > 50:
        eval_status["logs"] = eval_status["logs"][-50:]


class GlobalEvalResponse(BaseModel):
    status: str
    results: Optional[list] = None
    progress: Optional[int] = None
    total: Optional[int] = None
    current_model: Optional[str] = None
    current_prompt: Optional[str] = None
    current_pr: Optional[str] = None
    current_step: Optional[str] = None
    logs: Optional[list] = None


class EvalStartResponse(BaseModel):
    status: str
    message: str
    total_combinations: int


@router.get("/eval/prompts")
async def get_prompts():
    return {
        "prompts": [
            {"id": p["id"], "content": p["content"]}
            for p in SYSTEM_PROMPTS
        ]
    }


@router.get("/eval/models")
async def get_models():
    return {
        "models": eval_service.models
    }


@router.post("/eval/global/start", response_model=EvalStartResponse)
async def start_global_eval(background_tasks: BackgroundTasks):
    global eval_status, eval_results_cache
    
    if eval_status["running"]:
        raise HTTPException(status_code=400, detail="Evaluation already running")
    
    total = len(eval_service.models) * len(SYSTEM_PROMPTS)
    eval_status = {
        "running": True, 
        "progress": 0, 
        "total": total, 
        "current_model": "",
        "current_prompt": "",
        "current_pr": "",
        "current_step": "Initializing...",
        "logs": []
    }
    eval_results_cache = {}
    
    add_log(f"🚀 Starting global evaluation with {len(eval_service.models)} models and {len(SYSTEM_PROMPTS)} prompts")
    add_log(f"📊 Total combinations to test: {total}")
    add_log(f"📝 Dataset size: {len(eval_service.dataset)} PRs per combination")
    
    background_tasks.add_task(run_evaluation_task)
    
    return EvalStartResponse(
        status="started",
        message="Global evaluation started",
        total_combinations=total
    )


async def run_evaluation_task():
    global eval_status, eval_results_cache
    
    results = []
    total = len(eval_service.models) * len(SYSTEM_PROMPTS)
    current = 0
    
    for model_idx, model in enumerate(eval_service.models):
        add_log(f"")
        add_log(f"{'='*50}")
        add_log(f"🤖 Model {model_idx + 1}/{len(eval_service.models)}: {model}")
        add_log(f"{'='*50}")
        
        for prompt_idx, prompt in enumerate(SYSTEM_PROMPTS):
            eval_status["current_model"] = model
            eval_status["current_prompt"] = prompt["id"]
            eval_status["current_step"] = "Starting combination..."
            
            add_log(f"")
            add_log(f"📋 Testing: {model} + {prompt['id']}")
            
            try:
                # Run evaluation for this model/prompt combination
                combination_results = []
                
                for pr_idx, pr in enumerate(eval_service.dataset):
                    eval_status["current_pr"] = pr.id
                    eval_status["current_step"] = f"Evaluating PR {pr_idx + 1}/{len(eval_service.dataset)}"
                    
                    add_log(f"  → PR {pr_idx + 1}/{len(eval_service.dataset)}: {pr.id} (focus: {pr.expected_focus})")
                    
                    # Generate review
                    eval_status["current_step"] = f"Generating review for {pr.id}..."
                    add_log(f"    📝 Generating code review...")
                    review = eval_service.run_candidate_model(model, prompt["content"], pr.diff)
                    
                    if review.startswith("Error"):
                        add_log(f"    ❌ {review[:100]}")
                    else:
                        add_log(f"    ✅ Review generated ({len(review)} chars)")
                    
                    # Judge critical detection
                    eval_status["current_step"] = f"Judging critical detection..."
                    add_log(f"    🔍 Checking critical detection...")
                    critical_result = eval_service.judge_critical_detection(pr.diff, review, pr.expected_focus)
                    add_log(f"    {'✅' if critical_result.detected else '❌'} Critical: {critical_result.detected}")
                    
                    # Judge hallucination
                    eval_status["current_step"] = f"Checking for hallucinations..."
                    add_log(f"    🔍 Checking hallucinations...")
                    hallucination_result = eval_service.judge_hallucination(pr.diff, review)
                    add_log(f"    {'⚠️' if hallucination_result.detected else '✅'} Hallucination: {hallucination_result.detected}")
                    
                    # Judge helpfulness
                    eval_status["current_step"] = f"Evaluating helpfulness..."
                    add_log(f"    🔍 Checking helpfulness...")
                    helpfulness_result = eval_service.judge_helpfulness(review)
                    add_log(f"    {'✅' if helpfulness_result.detected else '❌'} Helpful: {helpfulness_result.detected}")
                    
                    combination_results.append({
                        "pr_id": pr.id,
                        "expected_focus": pr.expected_focus,
                        "review": review[:500] + "..." if len(review) > 500 else review,
                        "critical_detected": critical_result.detected,
                        "hallucinated": hallucination_result.detected,
                        "helpful": helpfulness_result.detected,
                        "critical_reason": critical_result.reason,
                        "hallucination_reason": hallucination_result.reason,
                    })
                
                # Calculate metrics
                n = len(combination_results)
                critical_rate = sum(1 for r in combination_results if r["critical_detected"]) / n
                hallucination_rate = sum(1 for r in combination_results if r["hallucinated"]) / n
                helpfulness_rate = sum(1 for r in combination_results if r["helpful"]) / n
                passed = critical_rate >= 0.5 and hallucination_rate <= 0.35
                
                add_log(f"")
                add_log(f"  📊 Results for {model} + {prompt['id']}:")
                add_log(f"     Critical Detection: {critical_rate*100:.1f}%")
                add_log(f"     Hallucination Rate: {hallucination_rate*100:.1f}%")
                add_log(f"     Helpfulness Rate: {helpfulness_rate*100:.1f}%")
                add_log(f"     Status: {'✅ PASSED' if passed else '❌ FILTERED'}")
                
                results.append({
                    "model": model,
                    "prompt_id": prompt["id"],
                    "prompt_content": prompt["content"],
                    "critical_detection_rate": critical_rate,
                    "hallucination_rate": hallucination_rate,
                    "helpfulness_rate": helpfulness_rate,
                    "passed": passed,
                    "details": combination_results
                })
                
            except Exception as e:
                add_log(f"  ❌ Error: {str(e)}")
                results.append({
                    "model": model,
                    "prompt_id": prompt["id"],
                    "prompt_content": prompt["content"],
                    "critical_detection_rate": 0,
                    "hallucination_rate": 1,
                    "helpfulness_rate": 0,
                    "passed": False,
                    "details": [{"error": str(e)}]
                })
            
            current += 1
            eval_status["progress"] = current
    
    # Final summary
    passed_count = sum(1 for r in results if r["passed"])
    add_log(f"")
    add_log(f"{'='*50}")
    add_log(f"🏁 EVALUATION COMPLETE")
    add_log(f"{'='*50}")
    add_log(f"✅ Passed: {passed_count}/{len(results)}")
    add_log(f"❌ Filtered: {len(results) - passed_count}/{len(results)}")
    
    eval_results_cache["results"] = results
    eval_status["running"] = False
    eval_status["progress"] = total
    eval_status["current_step"] = "Complete"


@router.get("/eval/global/status", response_model=GlobalEvalResponse)
async def get_eval_status():
    if eval_status["running"]:
        return GlobalEvalResponse(
            status="running",
            progress=eval_status["progress"],
            total=eval_status["total"],
            current_model=eval_status["current_model"],
            current_prompt=eval_status["current_prompt"],
            current_pr=eval_status["current_pr"],
            current_step=eval_status["current_step"],
            logs=eval_status["logs"][-20:]  # Return last 20 logs
        )
    
    if "results" in eval_results_cache:
        return GlobalEvalResponse(
            status="complete",
            results=eval_results_cache["results"],
            logs=eval_status["logs"][-20:]
        )
    
    return GlobalEvalResponse(status="idle", logs=[])


@router.get("/eval/global/results")
async def get_eval_results():
    if "results" not in eval_results_cache:
        raise HTTPException(status_code=404, detail="No evaluation results available. Run /eval/global/start first.")
    
    return {
        "status": "complete",
        "results": eval_results_cache["results"]
    }


class PRForFocus(BaseModel):
    id: int
    title: str
    diff: str


class GenerateFocusRequest(BaseModel):
    prs: List[PRForFocus]


class FocusResult(BaseModel):
    id: int
    focus: str
    explanation: str


@router.post("/eval/generate-focus")
async def generate_focus_for_prs(request: GenerateFocusRequest):
    """Generate expected focus areas for a list of PRs using the LLM."""
    results = []
    
    for pr in request.prs:
        focus_data = eval_service.generate_expected_focus(pr.diff, pr.title)
        results.append({
            "id": pr.id,
            "focus": focus_data["focus"],
            "explanation": focus_data["explanation"]
        })
    
    return {"results": results}


class PRForEval(BaseModel):
    id: int
    title: str
    diff: str
    expectedFocus: str


class RepoEvalRequest(BaseModel):
    prs: List[PRForEval]


repo_eval_status: dict = {
    "running": False,
    "progress": 0,
    "total": 0,
    "current_model": "",
    "current_prompt": "",
    "current_pr": "",
    "logs": []
}

repo_eval_results_cache: dict = {}


def add_repo_log(message: str):
    logger.info(message)
    repo_eval_status["logs"].append(message)
    if len(repo_eval_status["logs"]) > 50:
        repo_eval_status["logs"] = repo_eval_status["logs"][-50:]


@router.post("/eval/repo/start")
async def start_repo_eval(request: RepoEvalRequest, background_tasks: BackgroundTasks):
    global repo_eval_status, repo_eval_results_cache
    
    if repo_eval_status["running"]:
        raise HTTPException(status_code=400, detail="Evaluation already running")
    
    total = len(eval_service.models) * len(SYSTEM_PROMPTS)
    repo_eval_status = {
        "running": True,
        "progress": 0,
        "total": total,
        "current_model": "",
        "current_prompt": "",
        "current_pr": "",
        "logs": []
    }
    repo_eval_results_cache = {"prs": [pr.dict() for pr in request.prs]}
    
    add_repo_log(f"Starting repo-specific evaluation")
    add_repo_log(f"Models: {len(eval_service.models)}, Prompts: {len(SYSTEM_PROMPTS)}")
    add_repo_log(f"PRs to evaluate: {len(request.prs)}")
    
    background_tasks.add_task(run_repo_evaluation_task, request.prs)
    
    return {
        "status": "started",
        "message": "Repo evaluation started",
        "total_combinations": total
    }


async def run_repo_evaluation_task(prs: List[PRForEval]):
    global repo_eval_status, repo_eval_results_cache
    
    results = []
    total = len(eval_service.models) * len(SYSTEM_PROMPTS)
    current = 0
    
    for model in eval_service.models:
        add_repo_log(f"Testing model: {model}")
        
        for prompt in SYSTEM_PROMPTS:
            repo_eval_status["current_model"] = model
            repo_eval_status["current_prompt"] = prompt["id"]
            
            add_repo_log(f"  Prompt: {prompt['id']}")
            
            pr_results = []
            
            for pr in prs:
                repo_eval_status["current_pr"] = f"PR #{pr.id}"
                add_repo_log(f"    Evaluating PR #{pr.id}...")
                
                review = eval_service.run_candidate_model(model, prompt["content"], pr.diff)
                
                critical_result = eval_service.judge_critical_detection(
                    pr.diff, review, pr.expectedFocus
                )
                hallucination_result = eval_service.judge_hallucination(pr.diff, review)
                helpfulness_result = eval_service.judge_helpfulness(review)
                
                pr_results.append({
                    "pr_id": pr.id,
                    "expected_focus": pr.expectedFocus,
                    "critical_detected": critical_result.detected,
                    "hallucinated": hallucination_result.detected,
                    "helpful": helpfulness_result.detected,
                })
                
                status_icon = "PASS" if critical_result.detected else "MISS"
                add_repo_log(f"      Focus detection: {status_icon}")
            
            n = len(pr_results)
            critical_rate = sum(1 for r in pr_results if r["critical_detected"]) / n if n > 0 else 0
            hallucination_rate = sum(1 for r in pr_results if r["hallucinated"]) / n if n > 0 else 0
            helpfulness_rate = sum(1 for r in pr_results if r["helpful"]) / n if n > 0 else 0
            
            passed = critical_rate >= 0.5 and hallucination_rate <= 0.35
            verdict = "Recommended" if (critical_rate >= 0.8 and hallucination_rate <= 0.15) else ("Acceptable" if passed else "Rejected")
            
            results.append({
                "model": model,
                "promptId": prompt["id"],
                "promptContent": prompt["content"],
                "criticalDetectionRate": critical_rate,
                "hallucinationRate": hallucination_rate,
                "helpfulnessRate": helpfulness_rate,
                "passed": passed,
                "verdict": verdict,
                "explanation": f"Detection: {critical_rate:.0%}, Hallucination: {hallucination_rate:.0%}, Helpful: {helpfulness_rate:.0%}",
                "details": pr_results
            })
            
            add_repo_log(f"  Result: {verdict} (Detection: {critical_rate:.0%})")
            
            current += 1
            repo_eval_status["progress"] = current
    
    results.sort(key=lambda x: (x["criticalDetectionRate"], -x["hallucinationRate"]), reverse=True)
    for i, r in enumerate(results):
        r["rank"] = i + 1
    
    add_repo_log(f"Evaluation complete!")
    add_repo_log(f"Best: {results[0]['model']} + {results[0]['promptId']} (Detection: {results[0]['criticalDetectionRate']:.0%})")
    
    repo_eval_results_cache["results"] = results
    repo_eval_status["running"] = False


@router.get("/eval/repo/status")
async def get_repo_eval_status():
    if repo_eval_status["running"]:
        return {
            "status": "running",
            "progress": repo_eval_status["progress"],
            "total": repo_eval_status["total"],
            "current_model": repo_eval_status["current_model"],
            "current_prompt": repo_eval_status["current_prompt"],
            "current_pr": repo_eval_status["current_pr"],
            "logs": repo_eval_status["logs"][-20:]
        }
    
    if "results" in repo_eval_results_cache:
        return {
            "status": "complete",
            "results": repo_eval_results_cache["results"],
            "logs": repo_eval_status["logs"][-20:]
        }
    
    return {"status": "idle", "logs": []}
