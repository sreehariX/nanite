from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List
import asyncio
import logging
import time
from datetime import datetime
from app.services.eval_service import eval_service, SYSTEM_PROMPTS

# Configure logging to show timestamps
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
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
    "sub_progress": 0,
    "sub_total": 0,
    "start_time": None,
    "elapsed_time": 0,
    "logs": []
}


def add_log(message: str, level: str = "info"):
    """Add a log message to the status and print to console."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    formatted_msg = f"[{timestamp}] {message}"
    
    # Log to console with appropriate level
    if level == "error":
        logger.error(message)
    elif level == "warning":
        logger.warning(message)
    else:
        logger.info(message)
    
    # Add to status logs
    eval_status["logs"].append(formatted_msg)
    
    # Keep only last 100 logs
    if len(eval_status["logs"]) > 100:
        eval_status["logs"] = eval_status["logs"][-100:]


def update_elapsed_time():
    """Update the elapsed time in the status."""
    if eval_status["start_time"]:
        eval_status["elapsed_time"] = int(time.time() - eval_status["start_time"])


class GlobalEvalResponse(BaseModel):
    status: str
    results: Optional[list] = None
    progress: Optional[int] = None
    total: Optional[int] = None
    current_model: Optional[str] = None
    current_prompt: Optional[str] = None
    current_pr: Optional[str] = None
    current_step: Optional[str] = None
    sub_progress: Optional[int] = None
    sub_total: Optional[int] = None
    elapsed_time: Optional[int] = None
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
    dataset_size = len(eval_service.dataset)
    
    eval_status = {
        "running": True, 
        "progress": 0, 
        "total": total, 
        "current_model": "",
        "current_prompt": "",
        "current_pr": "",
        "current_step": "Initializing...",
        "sub_progress": 0,
        "sub_total": dataset_size,
        "start_time": time.time(),
        "elapsed_time": 0,
        "logs": []
    }
    eval_results_cache = {}
    
    print("\n" + "=" * 60)
    print("GLOBAL EVALUATION STARTED")
    print("=" * 60)
    
    add_log(f"Starting global evaluation")
    add_log(f"Models: {len(eval_service.models)} | Prompts: {len(SYSTEM_PROMPTS)} | Total: {total} combinations")
    add_log(f"Dataset: {dataset_size} PRs per combination")
    add_log(f"Estimated steps: {total * dataset_size * 4} (review + 3 judges each)")
    
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
    dataset_size = len(eval_service.dataset)
    
    for model_idx, model in enumerate(eval_service.models):
        print(f"\n{'='*60}")
        print(f"MODEL {model_idx + 1}/{len(eval_service.models)}: {model}")
        print(f"{'='*60}")
        
        add_log(f"")
        add_log(f"{'='*50}")
        add_log(f"Model {model_idx + 1}/{len(eval_service.models)}: {model}")
        add_log(f"{'='*50}")
        
        for prompt_idx, prompt in enumerate(SYSTEM_PROMPTS):
            eval_status["current_model"] = model
            eval_status["current_prompt"] = prompt["id"]
            eval_status["current_step"] = "Starting combination..."
            eval_status["sub_progress"] = 0
            eval_status["sub_total"] = dataset_size
            update_elapsed_time()
            
            # Allow status update to be sent
            await asyncio.sleep(0.01)
            
            print(f"\n  Testing: {model} + {prompt['id']}")
            add_log(f"")
            add_log(f"Testing: {model} + {prompt['id']}")
            
            try:
                combination_results = []
                
                for pr_idx, pr in enumerate(eval_service.dataset):
                    eval_status["current_pr"] = pr.id
                    eval_status["sub_progress"] = pr_idx + 1
                    update_elapsed_time()
                    
                    pr_step = f"PR {pr_idx + 1}/{dataset_size}"
                    print(f"\n    → {pr_step}: {pr.id} (focus: {pr.expected_focus})")
                    add_log(f"  → {pr_step}: {pr.id} (focus: {pr.expected_focus})")
                    
                    # Step 1: Generate review
                    eval_status["current_step"] = f"{pr_step} - Generating review..."
                    await asyncio.sleep(0.01)  # Allow status update
                    
                    print(f"      Generating code review...", end=" ", flush=True)
                    start = time.time()
                    review = eval_service.run_candidate_model(model, prompt["content"], pr.diff)
                    duration = time.time() - start
                    
                    if review.startswith("Error"):
                        print(f"ERROR ({duration:.1f}s)")
                        add_log(f"    Review error: {review[:80]}...", "error")
                    else:
                        print(f"OK ({len(review)} chars, {duration:.1f}s)")
                        add_log(f"    Review generated ({len(review)} chars, {duration:.1f}s)")
                    
                    # Step 2: Judge critical detection
                    eval_status["current_step"] = f"{pr_step} - Oumi Judge: Critical detection..."
                    await asyncio.sleep(0.01)
                    
                    print(f"      Oumi Judge: Critical detection...", end=" ", flush=True)
                    start = time.time()
                    critical_result = eval_service.judge_critical_detection(pr.diff, review, pr.expected_focus)
                    duration = time.time() - start
                    
                    status = "PASS" if critical_result.detected else "FAIL"
                    print(f"{status} ({duration:.1f}s)")
                    add_log(f"    Critical: {critical_result.detected} ({duration:.1f}s)")
                    
                    # Step 3: Judge hallucination
                    eval_status["current_step"] = f"{pr_step} - Oumi Judge: Hallucination check..."
                    await asyncio.sleep(0.01)
                    
                    print(f"      Oumi Judge: Hallucination check...", end=" ", flush=True)
                    start = time.time()
                    hallucination_result = eval_service.judge_hallucination(pr.diff, review)
                    duration = time.time() - start
                    
                    status = "WARN" if hallucination_result.detected else "OK"
                    print(f"{status} ({duration:.1f}s)")
                    add_log(f"    Hallucination: {hallucination_result.detected} ({duration:.1f}s)")
                    
                    # Step 4: Judge helpfulness
                    eval_status["current_step"] = f"{pr_step} - Oumi Judge: Helpfulness..."
                    await asyncio.sleep(0.01)
                    
                    print(f"      Oumi Judge: Helpfulness...", end=" ", flush=True)
                    start = time.time()
                    helpfulness_result = eval_service.judge_helpfulness(review)
                    duration = time.time() - start
                    
                    status = "PASS" if helpfulness_result.detected else "FAIL"
                    print(f"{status} ({duration:.1f}s)")
                    add_log(f"    Helpful: {helpfulness_result.detected} ({duration:.1f}s)")
                    
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
                
                print(f"\n    Results for {model} + {prompt['id']}:")
                print(f"       Critical Detection: {critical_rate*100:.1f}%")
                print(f"       Hallucination Rate: {hallucination_rate*100:.1f}%")
                print(f"       Helpfulness Rate:   {helpfulness_rate*100:.1f}%")
                print(f"       Status: {'PASSED' if passed else 'FILTERED'}")
                
                add_log(f"")
                add_log(f"  Results for {model} + {prompt['id']}:")
                add_log(f"     Critical Detection: {critical_rate*100:.1f}%")
                add_log(f"     Hallucination Rate: {hallucination_rate*100:.1f}%")
                add_log(f"     Helpfulness Rate: {helpfulness_rate*100:.1f}%")
                add_log(f"     Status: {'PASSED' if passed else 'FILTERED'}")
                
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
                print(f"\n    Error: {str(e)}")
                add_log(f"  Error: {str(e)}", "error")
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
            update_elapsed_time()
    
    # Final summary
    passed_count = sum(1 for r in results if r["passed"])
    total_time = int(time.time() - eval_status["start_time"])
    
    print(f"\n{'='*60}")
    print(f"EVALUATION COMPLETE")
    print(f"{'='*60}")
    print(f"Passed: {passed_count}/{len(results)}")
    print(f"Filtered: {len(results) - passed_count}/{len(results)}")
    print(f"Total time: {total_time}s")
    print(f"{'='*60}\n")
    
    add_log(f"")
    add_log(f"{'='*50}")
    add_log(f"EVALUATION COMPLETE")
    add_log(f"{'='*50}")
    add_log(f"Passed: {passed_count}/{len(results)}")
    add_log(f"Filtered: {len(results) - passed_count}/{len(results)}")
    add_log(f"Total time: {total_time}s")
    
    eval_results_cache["results"] = results
    eval_status["running"] = False
    eval_status["progress"] = total
    eval_status["current_step"] = "Complete"


@router.get("/eval/global/status", response_model=GlobalEvalResponse)
async def get_eval_status():
    update_elapsed_time()
    
    if eval_status["running"]:
        return GlobalEvalResponse(
            status="running",
            progress=eval_status["progress"],
            total=eval_status["total"],
            current_model=eval_status["current_model"],
            current_prompt=eval_status["current_prompt"],
            current_pr=eval_status["current_pr"],
            current_step=eval_status["current_step"],
            sub_progress=eval_status["sub_progress"],
            sub_total=eval_status["sub_total"],
            elapsed_time=eval_status["elapsed_time"],
            logs=eval_status["logs"][-30:]  # Return last 30 logs
        )
    
    if "results" in eval_results_cache:
        return GlobalEvalResponse(
            status="complete",
            results=eval_results_cache["results"],
            elapsed_time=eval_status["elapsed_time"],
            logs=eval_status["logs"][-30:]
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
    
    for i, pr in enumerate(request.prs):
        print(f"  Generating focus for PR #{pr.id} ({i+1}/{len(request.prs)})...")
        focus_data = eval_service.generate_expected_focus(pr.diff, pr.title)
        results.append({
            "id": pr.id,
            "focus": focus_data["focus"],
            "explanation": focus_data["explanation"]
        })
        print(f"    → Focus: {focus_data['focus']}")
    
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
    "current_step": "",
    "sub_progress": 0,
    "sub_total": 0,
    "start_time": None,
    "elapsed_time": 0,
    "logs": []
}

repo_eval_results_cache: dict = {}


def add_repo_log(message: str, level: str = "info"):
    """Add a log message to the repo status and print to console."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    formatted_msg = f"[{timestamp}] {message}"
    
    if level == "error":
        logger.error(message)
    else:
        logger.info(message)
    
    repo_eval_status["logs"].append(formatted_msg)
    if len(repo_eval_status["logs"]) > 100:
        repo_eval_status["logs"] = repo_eval_status["logs"][-100:]


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
        "current_step": "Initializing...",
        "sub_progress": 0,
        "sub_total": len(request.prs),
        "start_time": time.time(),
        "elapsed_time": 0,
        "logs": []
    }
    repo_eval_results_cache = {"prs": [pr.dict() for pr in request.prs]}
    
    print("\n" + "=" * 60)
    print("REPO-SPECIFIC EVALUATION STARTED")
    print("=" * 60)
    
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
    
    for model_idx, model in enumerate(eval_service.models):
        print(f"\n{'='*60}")
        print(f"MODEL {model_idx + 1}/{len(eval_service.models)}: {model}")
        print(f"{'='*60}")
        
        add_repo_log(f"Testing model: {model}")
        
        for prompt_idx, prompt in enumerate(SYSTEM_PROMPTS):
            repo_eval_status["current_model"] = model
            repo_eval_status["current_prompt"] = prompt["id"]
            repo_eval_status["current_step"] = f"Testing {model} + {prompt['id']}"
            repo_eval_status["sub_progress"] = 0
            repo_eval_status["sub_total"] = len(prs)
            
            await asyncio.sleep(0.01)
            
            print(f"\n  Prompt: {prompt['id']}")
            add_repo_log(f"  Prompt: {prompt['id']}")
            
            pr_results = []
            
            for pr_idx, pr in enumerate(prs):
                repo_eval_status["current_pr"] = f"PR #{pr.id}"
                repo_eval_status["sub_progress"] = pr_idx + 1
                repo_eval_status["elapsed_time"] = int(time.time() - repo_eval_status["start_time"])
                
                print(f"\n    → PR #{pr.id} ({pr_idx + 1}/{len(prs)})")
                add_repo_log(f"    → Evaluating PR #{pr.id}...")
                
                # Generate review
                repo_eval_status["current_step"] = f"PR #{pr.id} - Generating review..."
                await asyncio.sleep(0.01)
                
                print(f"      Generating review...", end=" ", flush=True)
                start = time.time()
                review = eval_service.run_candidate_model(model, prompt["content"], pr.diff)
                print(f"OK ({time.time() - start:.1f}s)")
                
                # Judge critical
                repo_eval_status["current_step"] = f"PR #{pr.id} - Oumi Judge: Critical..."
                await asyncio.sleep(0.01)
                
                print(f"      Critical detection...", end=" ", flush=True)
                start = time.time()
                critical_result = eval_service.judge_critical_detection(pr.diff, review, pr.expectedFocus)
                status = "PASS" if critical_result.detected else "FAIL"
                print(f"{status} ({time.time() - start:.1f}s)")
                
                # Judge hallucination
                repo_eval_status["current_step"] = f"PR #{pr.id} - Oumi Judge: Hallucination..."
                await asyncio.sleep(0.01)
                
                print(f"      Hallucination check...", end=" ", flush=True)
                start = time.time()
                hallucination_result = eval_service.judge_hallucination(pr.diff, review)
                status = "WARN" if hallucination_result.detected else "OK"
                print(f"{status} ({time.time() - start:.1f}s)")
                
                # Judge helpfulness
                repo_eval_status["current_step"] = f"PR #{pr.id} - Oumi Judge: Helpfulness..."
                await asyncio.sleep(0.01)
                
                print(f"      Helpfulness...", end=" ", flush=True)
                start = time.time()
                helpfulness_result = eval_service.judge_helpfulness(review)
                status = "PASS" if helpfulness_result.detected else "FAIL"
                print(f"{status} ({time.time() - start:.1f}s)")
                
                pr_results.append({
                    "pr_id": pr.id,
                    "expected_focus": pr.expectedFocus,
                    "critical_detected": critical_result.detected,
                    "hallucinated": hallucination_result.detected,
                    "helpful": helpfulness_result.detected,
                })
                
                detection_status = "PASS" if critical_result.detected else "MISS"
                add_repo_log(f"      Focus detection: {detection_status}")
            
            n = len(pr_results)
            critical_rate = sum(1 for r in pr_results if r["critical_detected"]) / n if n > 0 else 0
            hallucination_rate = sum(1 for r in pr_results if r["hallucinated"]) / n if n > 0 else 0
            helpfulness_rate = sum(1 for r in pr_results if r["helpful"]) / n if n > 0 else 0
            
            passed = critical_rate >= 0.5 and hallucination_rate <= 0.35
            verdict = "Recommended" if (critical_rate >= 0.8 and hallucination_rate <= 0.15) else ("Acceptable" if passed else "Rejected")
            
            print(f"\n    Result: {verdict} (Det: {critical_rate:.0%}, Hall: {hallucination_rate:.0%})")
            add_repo_log(f"  Result: {verdict} (Detection: {critical_rate:.0%})")
            
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
            
            current += 1
            repo_eval_status["progress"] = current
    
    results.sort(key=lambda x: (x["criticalDetectionRate"], -x["hallucinationRate"]), reverse=True)
    for i, r in enumerate(results):
        r["rank"] = i + 1
    
    total_time = int(time.time() - repo_eval_status["start_time"])
    
    print(f"\n{'='*60}")
    print(f"EVALUATION COMPLETE")
    print(f"{'='*60}")
    print(f"Best: {results[0]['model']} + {results[0]['promptId']} (Det: {results[0]['criticalDetectionRate']:.0%})")
    print(f"Total time: {total_time}s")
    print(f"{'='*60}\n")
    
    add_repo_log(f"Evaluation complete!")
    add_repo_log(f"Best: {results[0]['model']} + {results[0]['promptId']} (Detection: {results[0]['criticalDetectionRate']:.0%})")
    add_repo_log(f"Total time: {total_time}s")
    
    repo_eval_results_cache["results"] = results
    repo_eval_status["running"] = False
    repo_eval_status["elapsed_time"] = total_time


@router.get("/eval/repo/status")
async def get_repo_eval_status():
    if repo_eval_status["start_time"]:
        repo_eval_status["elapsed_time"] = int(time.time() - repo_eval_status["start_time"])
    
    if repo_eval_status["running"]:
        return {
            "status": "running",
            "progress": repo_eval_status["progress"],
            "total": repo_eval_status["total"],
            "current_model": repo_eval_status["current_model"],
            "current_prompt": repo_eval_status["current_prompt"],
            "current_pr": repo_eval_status["current_pr"],
            "current_step": repo_eval_status["current_step"],
            "sub_progress": repo_eval_status["sub_progress"],
            "sub_total": repo_eval_status["sub_total"],
            "elapsed_time": repo_eval_status["elapsed_time"],
            "logs": repo_eval_status["logs"][-30:]
        }
    
    if "results" in repo_eval_results_cache:
        return {
            "status": "complete",
            "results": repo_eval_results_cache["results"],
            "elapsed_time": repo_eval_status["elapsed_time"],
            "logs": repo_eval_status["logs"][-30:]
        }
    
    return {"status": "idle", "logs": []}
