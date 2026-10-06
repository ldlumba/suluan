# SULUAN Semantic Search Test Cases

## Adviser-approved query set

This document records the query set reviewed by the adviser for SULUAN's
Semantic AI Search. Specific Objective 2 says that these behaviors should be
assessed using adviser-approved test cases.

The adviser indicated that the listed queries were acceptable and requested an
additional query about AI-assisted farming that may return projects related to
farming or helpful to farmers. That request is represented as a multi-result
case in `services/processing/semantic_adviser_approved_queries.json`.

**Frozen file SHA-256:** `c459cbc52eaa77155efa2a9700818f4b53a6086e0d843158a2e2d8964dc7e5ca`

The adviser review did not require localhost access. The approval reply was:

> Maglagay siguro kayo sa proposed query yung for example "AI assisted farming"
> tapos magrereturn ng projects related sa farming or helpful sa farmers. Yung
> queries na binigay niyo na nasa docs okay naman.

The JSON file is the frozen approved set for evaluation. Its SHA-256 must be
recorded before the evaluation run. It should be run against the complete
repository, not only the current staging records.

## A. Direct topic searches

| ID | Proposed query | Proposed expected paper |
|---|---|---|
| A1 | antibacterial activity of water spinach extract | *In Vitro Antibacterial Activity of Ipomoea aquatica Extract against Staphylococcus aureus and Escherichia coli* |
| A2 | financial literacy of public market vendors in Apalit | *Beyond the Bargain: Assessing the Role of Financial Literacy on Business Performance among Apalit Public Market Vendors* |
| A3 | travel behavior of tourism students | *TRAVEL BEHAVIOR AMONG TOURISM STUDENTS AT THE UNIVERSITY OF THE ASSUMPTION* |
| A4 | single mothers accessing government health services | *Filipino Single Mothers' Access To Government Healthcare: A Qualitative Inquiry* |

## B. Concept-based searches

These use different wording from the expected paper's title.

| ID | Proposed query | Proposed expected paper |
|---|---|---|
| B1 | does feeling connected to nature affect how students treat the environment | *Nature's Voice, Leader's Choice: Nature Connectedness and Pro-Environmental Behavior Among College Student Leaders* |
| B2 | can a short-video creator persuade people to buy a local product | *Asheng's Influence on Customers' Purchase Intentions for Ashscents Perfume on TikTok* |
| B3 | how can traditional cooking knowledge be preserved for future generations | *Pamánam: A Culinary Museum and Food Heritage Institute* |

## C. Boundary and near-match searches

For these, please confirm which paper should win and whether the query is
specific enough.

| ID | Proposed query | Proposed winner | Possible near-match |
|---|---|---|---|
| C1 | does using AI improve students' grades | *THE ASSESSMENT OF ARTIFICIAL INTELLIGENCE ON THE ACADEMIC PERFORMANCE OF HOSPITALITY AND TOURISM MANAGEMENT STUDENTS AT THE UNIVERSITY OF THE ASSUMPTION* | Other papers may involve AI but not student performance. |
| C2 | affordable farming technology for local farmers | *AgriKlima: Empowering District 3 Farmers in Pampanga using Localized Farming Solutions* | *SoilScope* also involves agriculture and technology. |
| C3 | how can businesses produce better financial statements | *Data Driven Decision Making: Optimizing the Quality of Financial Reporting* | The public-market-vendor paper also involves financial performance. |
| C4 | a place for preserving regional food traditions | *Pamánam: A Culinary Museum and Food Heritage Institute* | Tourism and other cultural-heritage papers may be nearby. |

## D. No-match searches

The expected behavior is to return no sufficiently relevant paper. Please
confirm these remain no-match queries after considering the complete corpus.

| ID | Proposed query | Why it may be a no-match |
|---|---|---|
| D1 | quantum chromodynamics lattice simulation | No physics study is currently known in the repository. |
| D2 | how do I install Linux on a laptop | This is technical support, not a research-record query. |
| D3 | salary negotiation advice for fresh graduates | This is career advice rather than a thesis topic. |
| D4 | comparative analysis of Nordic and Philippine tax systems | No comparative tax-policy study is currently known in the repository. |

## E. Cross-topic and multi-result searches

These test whether search can return useful papers when a query combines two
related ideas. They should not be judged by one exact title only. A successful
result should include relevant papers from both expected areas, in any order.

| ID | Proposed query | Expected relevant papers or areas |
|---|---|---|
| E1 | AI-assisted farming projects that could help local farmers | *AgriKlima: Empowering District 3 Farmers in Pampanga using Localized Farming Solutions* and *SoilScope: An AI-Powered Mobile Application for Soil Analysis and Disease Detection* |
| E2 | technology that helps farmers understand soil conditions and improve farming | *SoilScope* and/or *AgriKlima*, depending on the adviser's preferred interpretation |

## Adviser-added queries

| ID | Query | Expected paper or “no match” |
|---|---|---|
| F1 |  |  |
| F2 |  |  |
| F3 |  |  |
