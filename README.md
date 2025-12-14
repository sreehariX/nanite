# nanite

Find the best AI model and system prompt combination for code review.

## What is this?

Nanite helps you figure out which AI model and system prompt work best for reviewing pull requests in your codebase. Instead of guessing, it tests different combinations against your actual PRs and tells you which one performs best.

## How it works

1. You provide a GitHub repository URL
2. Nanite fetches your closed PRs
3. It tests different model and prompt combinations by generating code reviews
4. Uses Oumi's LLM-as-judge framework to evaluate each review on three criteria:
   - Critical detection: Does it catch important issues?
   - Hallucination: Does it make up problems that don't exist?
   - Helpfulness: Is the feedback actually useful?
5. Returns the best combination ranked by performance

The evaluation uses binary yes/no judgments from Oumi judges, then averages them to calculate rates. For example, if 7 out of 10 PRs correctly detect critical issues, that's a 70% critical detection rate.

## Tech Stack

- Frontend: Next.js 14 on Vercel
- Backend: FastAPI on Azure VM
- Evaluation: Oumi framework with Perplexity Sonar models
- Judges: Three custom Oumi judges for critical detection, hallucination, and helpfulness

## Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
export PERPLEXITY_API_KEY=your-key-here
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Make sure to set the `NEXT_PUBLIC_API_URL` environment variable to point to your backend.

## License

See LICENSE file for details.
