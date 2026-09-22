# Benchmark research basis

The 500 post benchmark is original synthetic test data. It does not copy source posts. Public material was used only to identify realistic writing patterns, hard negative archetypes, and evaluation risks.

## Label standard

LinkedIn now describes AI slop as low effort content that may sound polished but lacks a clear point of view, unique perspective, or substance. LinkedIn also says generic claims, repeated ideas, missing specific information, and template style content can feel low value. The benchmark therefore measures low substance writing patterns rather than trying to prove who or what wrote a post.

Sources:

1. LinkedIn Help, Best practices for content created with the help of AI: https://www.linkedin.com/help/linkedin/answer/a1123063
2. LinkedIn Marketing Solutions Help, AI slop feedback option for ads on the LinkedIn feed: https://www.linkedin.com/help/lms/answer/a16201003
3. LinkedIn News, How LinkedIn is Continuing to Tackle AI Slop: https://news.linkedin.com/2026/how-linkedin-is-tackling-ai-slop

## Hard negative archetypes

The hard negatives deliberately contain surface cues that could fool a weak detector while still providing real value.

1. Familiar or dramatic opening plus measured experiment, caveat, and mechanism. A public LinkedIn example uses a strong growth hook but then gives a stated hypothesis, setup, control, variant and measured signup result: https://www.linkedin.com/posts/kevbosaurus_we-ran-an-experiment-that-grew-product-signups-activity-7414729414992863232-zoY4
2. Keyword comment call to action after useful instructions are already present. A public project control post gives detailed setup steps before offering a file through comments: https://www.linkedin.com/posts/prakash-karthik-raja-chandra-sekaran_constructionmanagement-documentsolutions-activity-7495095687726993408-d3tT
3. Quoted engagement bait used as criticism rather than as the author's own tactic. A public post criticizes keyword comment gating and argues that the useful material should be shared directly: https://www.linkedin.com/posts/harriet-meyer_i-love-linkedin-i-really-do-but-the-comment-activity-7444403410415616000-Jwyb
4. Rhetorical contrast supported by a specific experience. A public operations post uses a familiar contrast about activity versus results, then grounds it in concrete operational questions and firsthand context: https://www.linkedin.com/posts/david-george-4a4b94188_leadership-operations-execution-activity-7495883430438592513-rmOK
5. Simple English with real facts and measurements. Research has shown that some AI text detectors can falsely flag non native English writing, so simple vocabulary and repetitive syntax are included as fairness hard negatives: https://doi.org/10.1016/j.patter.2023.100779

## Robustness design

RAID shows that text detectors can fail under domain shifts, adversarial edits, different generation settings, and unseen models. Another ACL study shows that small character or word changes can reverse detector decisions. NIST evaluates text discriminators using formal metrics rather than a handful of clean examples. These findings informed the benchmark mix of domains, languages, difficult negatives, uncertain cases, and varied surface forms.

Sources:

1. RAID, ACL 2024: https://aclanthology.org/2024.acl-long.674/
2. Are AI Generated Text Detectors Robust to Adversarial Perturbations, ACL 2024: https://aclanthology.org/2024.acl-long.327/
3. NIST GenAI Text to Text Evaluation Overview and Results: https://www.nist.gov/publications/2024-nist-genai-pilot-study-text-text-evaluation-overview-and-results

## Dataset composition

The benchmark contains 500 unique posts.

| Group | Count |
| --- | ---: |
| Clear | 250 |
| Slop | 200 |
| Uncertain | 50 |
| Hard negatives inside Clear | 150 |
| English | 300 |
| Arabic | 80 |
| Turkish | 80 |
| Mixed language | 40 |

The hard negative set covers familiar hooks, engagement calls, corporate terminology, motivational framing, rhetorical contrasts, numbered structures, technical language, and simple English. Each hard negative still contains concrete evidence, mechanism, instructions, constraints, or firsthand context that should prevent a slop verdict.

## Diversity checks

The benchmark validation suite rejects exact duplicate posts, near duplicate token sets above a strict ceiling, and overly similar hard negatives. Repetition remains intentionally present inside the slop class because generic reuse is part of the behavior being measured, but the clear hard negatives are kept materially distinct so the benchmark cannot be passed by memorising one counterexample template.
