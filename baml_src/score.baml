class ScoredArticle {
  url string
  score int @description("1-100 developer-actionability rating")
}

function ScoreArticles(articles: ArticleInput[]) -> ScoredArticle[] {
  client Nvidia
  prompt #"
    {{ _.role("system") }}
    You are a senior editorial analyst at a developer news platform. Your job is to evaluate articles for relevance and actionability for AI builders. You are precise, consistent, and ruthless about filtering noise.

    {{ _.role("user") }}
    Score every article for developer-actionability on a 1-100 scale.

    STEP 1 - SCOPE CHECK (apply first, before scoring):
    Is the article about AI, ML, LLMs, foundation models, or AI-adjacent developer tools/infrastructure?
    - NO → score 1-20 and move on. Do NOT apply the scoring guide below.
    - Out-of-scope examples: text editors, parsers, version control tools, data structures (CRDTs, B-trees), memory management, general programming tutorials, non-AI open source projects, codebase audits, legacy code. These are general software engineering - not AI.

    STEP 2 - SCORE (only for in-scope articles):
    Audience: developers, startup founders, and tech leaders building with AI who want to ship faster.

    Score 91-100 is reserved for exceptional articles that are BOTH immediately actionable today AND fit one of these themes: local/on-device inference, privacy-preserving AI, efficiency breakthroughs (quantization, token optimization, running models on less hardware), or deep technical dives that explain how something actually works. A score in this range means "a developer could open a terminal and act on this within the hour, AND it reveals a non-obvious insight or technique." Zero is a valid outcome - do not give 91+ just because something is the best of a weak batch.

    Models (new releases, benchmarks, evals, model cards, comparisons):
    - 81-90: New model release or major update, model system cards, open-weight models a developer can run today
    - 71-80: Meaningful benchmark or eval, model comparison with actionable conclusions

    Dev (SDKs, frameworks, CLI tools, IDE integrations, open-source projects, tutorials, deployment):
    - 81-90: New AI API or SDK, open-source AI tool/library a developer can use today
    - 71-80: Fine-tuning guide, RAG pattern, significant framework update, AI infrastructure (training, inference, memory optimization), deployment recipes

    Research (papers, breakthroughs, novel techniques):
    - 71-80: Research with immediate practical implications, AI security research
    - 51-60: Research with near-term practical implications

    Industry (funding, platform changes, acquisitions, partnerships, market shifts):
    - 51-60: Industry analysis with actionable takeaways, AI platform partnerships
    - 31-40: Funding rounds without product details, opinion/commentary with no actionable steps, "AI is changing everything" think pieces, personal anecdotes about using AI

    Upgrade to 91-100: if an article would score 81-90 AND fits the top-tier criteria above (local inference, privacy-preserving, efficiency breakthrough, or deep how-it-works dive), give it 91-100.

    Bottom tier:
    - 1-20: Non-AI topics (see step 1), regulation, politics, lawsuits, corporate drama

    Trust bonus: entries may include a [trust: high/medium/low] tag. Give +1 to high-trust sources when content quality is comparable.

    Articles:
    {% for a in articles %}
    {{ loop.index }}. [{{ a.source }}] "{{ a.title }}" - {{ a.url }}{% if a.trust %} [trust: {{ a.trust }}]{% endif %}
    {% if a.snippet %}   {{ a.snippet }}{% endif %}
    {% endfor %}

    {{ ctx.output_format }}
  "#
}

test score_gpt5_release {
  functions [ScoreArticles]
  args {
    articles [
      {
        url "https://openai.com/index/introducing-gpt-5"
        title "Introducing GPT-5"
        source "Hacker News"
        trust "medium"
      }
    ]
  }
}

test score_out_of_scope {
  functions [ScoreArticles]
  args {
    articles [
      {
        url "https://example.com/crdt-deep-dive"
        title "A Deep Dive Into CRDTs and Conflict Resolution"
        source "Some Blog"
        trust "low"
      }
    ]
  }
}
