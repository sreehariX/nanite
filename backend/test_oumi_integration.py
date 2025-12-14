#!/usr/bin/env python3
"""
Test script to verify Oumi integration is working correctly.
Run from the backend directory: python test_oumi_integration.py
"""
import os
import sys
from pathlib import Path

# Add the app directory to the path
sys.path.insert(0, str(Path(__file__).parent))

def check_env():
    """Check if required environment variables are set."""
    print("=" * 50)
    print("1. Checking Environment Variables")
    print("=" * 50)
    
    api_key = os.getenv("PERPLEXITY_API_KEY")
    if not api_key:
        print("❌ PERPLEXITY_API_KEY is not set!")
        print("   Set it with: export PERPLEXITY_API_KEY='your-key-here'")
        return False
    else:
        print(f"✅ PERPLEXITY_API_KEY is set (length: {len(api_key)})")
    return True


def check_oumi_import():
    """Check if Oumi can be imported correctly."""
    print("\n" + "=" * 50)
    print("2. Checking Oumi Import")
    print("=" * 50)
    
    try:
        from oumi.judges.simple_judge import SimpleJudge
        from oumi.core.configs.judge_config import JudgeConfig
        print("✅ Oumi imports successful")
        print(f"   - SimpleJudge: {SimpleJudge}")
        print(f"   - JudgeConfig: {JudgeConfig}")
        return True
    except ImportError as e:
        print(f"❌ Failed to import Oumi: {e}")
        print("   Install with: pip install oumi oumi[evaluation]")
        return False


def check_yaml_configs():
    """Check if judge YAML configs can be loaded."""
    print("\n" + "=" * 50)
    print("3. Checking Judge YAML Configurations")
    print("=" * 50)
    
    judges_dir = Path(__file__).parent / "app" / "judges"
    yaml_files = ["critical_detection.yaml", "hallucination.yaml", "helpfulness.yaml"]
    
    all_found = True
    for yaml_file in yaml_files:
        path = judges_dir / yaml_file
        if path.exists():
            print(f"✅ Found: {yaml_file}")
        else:
            print(f"❌ Missing: {yaml_file}")
            all_found = False
    
    return all_found


def check_judge_loading():
    """Check if judges can be loaded from YAML configs."""
    print("\n" + "=" * 50)
    print("4. Loading Oumi Judges from YAML")
    print("=" * 50)
    
    try:
        from oumi.judges.simple_judge import SimpleJudge
        
        judges_dir = Path(__file__).parent / "app" / "judges"
        
        # Try loading each judge
        judges = {}
        for name in ["critical_detection", "hallucination", "helpfulness"]:
            yaml_path = judges_dir / f"{name}.yaml"
            print(f"   Loading {name}...")
            judges[name] = SimpleJudge(judge_config=str(yaml_path))
            print(f"✅ Loaded: {name}")
        
        return judges
    except Exception as e:
        print(f"❌ Failed to load judges: {e}")
        import traceback
        traceback.print_exc()
        return None


def test_judge_execution(judges):
    """Run a simple test with each judge."""
    print("\n" + "=" * 50)
    print("5. Testing Judge Execution (Live API Call)")
    print("=" * 50)
    
    if not judges:
        print("⚠️  Skipping - judges not loaded")
        return False
    
    # Test data
    test_diff = """
diff --git a/payment.py b/payment.py
--- a/payment.py
+++ b/payment.py
@@ -10,7 +10,6 @@ def process_payment(user_id, amount):
-    if not validate_idempotency_key(request.idempotency_key):
-        return {"error": "Duplicate request"}
     charge = stripe.Charge.create(amount=amount, customer=user_id)
     return {"success": True, "charge_id": charge.id}
"""
    
    test_review = """
This change removes the idempotency check before processing payments.
This could lead to duplicate charges if the same request is submitted multiple times.
I recommend keeping the idempotency validation to prevent accidental double-charging.
"""
    
    try:
        # Test critical detection
        print("\n   Testing critical_detection judge...")
        outputs = judges["critical_detection"].judge([{
            "diff": test_diff,
            "review": test_review,
            "expected_focus": "duplicate charges or transactions without idempotency"
        }])
        
        if outputs and len(outputs) > 0:
            judgment = outputs[0].field_values.get("judgment")
            explanation = outputs[0].field_values.get("explanation", "No explanation")
            print(f"   ✅ Critical Detection Result:")
            print(f"      Judgment: {judgment}")
            print(f"      Explanation: {explanation[:100]}...")
        else:
            print("   ⚠️  No output received")
        
        # Test hallucination
        print("\n   Testing hallucination judge...")
        outputs = judges["hallucination"].judge([{
            "diff": test_diff,
            "review": test_review,
        }])
        
        if outputs and len(outputs) > 0:
            judgment = outputs[0].field_values.get("judgment")
            explanation = outputs[0].field_values.get("explanation", "No explanation")
            print(f"   ✅ Hallucination Detection Result:")
            print(f"      Judgment: {judgment} (False means no hallucination)")
            print(f"      Explanation: {explanation[:100]}...")
        
        # Test helpfulness
        print("\n   Testing helpfulness judge...")
        outputs = judges["helpfulness"].judge([{
            "review": test_review,
        }])
        
        if outputs and len(outputs) > 0:
            judgment = outputs[0].field_values.get("judgment")
            explanation = outputs[0].field_values.get("explanation", "No explanation")
            print(f"   ✅ Helpfulness Result:")
            print(f"      Judgment: {judgment}")
            print(f"      Explanation: {explanation[:100]}...")
        
        return True
        
    except Exception as e:
        print(f"❌ Judge execution failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_eval_service():
    """Test the full EvalService integration."""
    print("\n" + "=" * 50)
    print("6. Testing Full EvalService")
    print("=" * 50)
    
    try:
        from app.services.eval_service import eval_service, SYSTEM_PROMPTS
        
        print(f"✅ EvalService loaded successfully")
        print(f"   - Models: {eval_service.models}")
        print(f"   - Dataset size: {len(eval_service.dataset)} items")
        print(f"   - Prompts: {len(SYSTEM_PROMPTS)}")
        print(f"   - Judge: {type(eval_service.judge).__name__}")
        
        return True
        
    except Exception as e:
        print(f"❌ EvalService failed to load: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("\n" + "=" * 50)
    print("  OUMI INTEGRATION TEST")
    print("=" * 50)
    
    results = {}
    
    # Step 1: Check environment
    results["env"] = check_env()
    
    if not results["env"]:
        print("\n⚠️  Please set PERPLEXITY_API_KEY and run again")
        print("   export PERPLEXITY_API_KEY='your-api-key-here'")
        return
    
    # Step 2: Check Oumi import
    results["import"] = check_oumi_import()
    
    if not results["import"]:
        print("\n⚠️  Please install Oumi: pip install oumi oumi[evaluation]")
        return
    
    # Step 3: Check YAML configs
    results["yaml"] = check_yaml_configs()
    
    # Step 4: Load judges
    judges = check_judge_loading()
    results["loading"] = judges is not None
    
    # Step 5: Test judge execution (optional - makes API calls)
    print("\n" + "-" * 50)
    run_live = input("Run live API test? This will make Perplexity API calls. (y/n): ").strip().lower()
    
    if run_live == 'y':
        results["execution"] = test_judge_execution(judges)
    else:
        print("⏭️  Skipping live API test")
        results["execution"] = None
    
    # Step 6: Test EvalService
    results["eval_service"] = test_eval_service()
    
    # Summary
    print("\n" + "=" * 50)
    print("  TEST SUMMARY")
    print("=" * 50)
    
    for test_name, passed in results.items():
        if passed is None:
            status = "⏭️  SKIPPED"
        elif passed:
            status = "✅ PASSED"
        else:
            status = "❌ FAILED"
        print(f"   {test_name}: {status}")
    
    all_passed = all(v is True or v is None for v in results.values())
    
    if all_passed:
        print("\n🎉 All tests passed! Oumi integration is working correctly.")
    else:
        print("\n⚠️  Some tests failed. Please check the errors above.")


if __name__ == "__main__":
    main()

