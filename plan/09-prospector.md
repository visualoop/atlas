# 09 · Prospector

Google Maps lead generation, end to end. Search → enrich → import → first-touch. Designed for the Omnix outreach motion (pharmacies in Kasarani, hardware stores in Eldoret) but works for any workspace.

## The flow in one paragraph

You type "pharmacies in Mombasa" into the Prospector search. Atlas calls Google Places API (New) Text Search with a tight FieldMask. 60–100 results come back. Each becomes a Company record (deduplicated by Google `place_id`). A background job fetches each company's website, runs Gemini Flash to extract email + social links + business type, normalizes the phone to E.164 and flags WhatsApp-able numbers. AI scores fit per workspace (0–100). You see the results on a map + table, multi-select the good ones, bulk-import to the pipeline at "Cold" stage. AI then generates personalized first-touch messages (email + WhatsApp) per company. You approve in batches; sends queue via Resend + Meta. Suppression list ensures you never contact the same place twice.

## Cost model

- Google Places API (New) Text Search: **$0.017 per call** with FieldMask (basic fields)
- Free Google Cloud credit: **$200/mo** = ~11,000 searches free
- Each search returns ~20–60 results in one billable call (with `pageSize=20` to `60`)
- Enrichment uses Gemini Flash (free tier) for email extraction
- Phone normalization uses local code (free)

**Realistic monthly use:** 30–100 searches × 30 days = ~$15–50/mo of credit, comfortably inside the free $200.

## Architecture

```
                 ┌─────────────────┐
                 │  User UI         │
                 │  "pharmacies in  │
                 │  Mombasa" + map  │
                 └────────┬─────────┘
                          │
                          ▼
                 ┌─────────────────────────────────┐
                 │  Server Action                   │
                 │  prospectorSearch(workspaceId,   │
                 │    query, location, radius)      │
                 └────────┬────────────────────────┘
                          │
        ┌─────────────────┴──────────────────┐
        ▼                                    ▼
 ┌──────────────────────┐         ┌─────────────────────┐
 │ Google Places API    │         │ Dedup: existing     │
 │ Text Search v1       │         │ companies by        │
 │ + FieldMask          │         │ place_id (cache)    │
 └──────────┬───────────┘         └─────────┬───────────┘
            │                                │
            └───────────────┬────────────────┘
                            ▼
                  ┌──────────────────────┐
                  │  Insert/upsert       │
                  │  companies (state:   │
                  │  'pending_enrich')   │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  Enqueue pg-boss     │
                  │  job per company:    │
                  │  enrich-company      │
                  └──────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                              ▼
   ┌────────────────────┐         ┌───────────────────┐
   │ Fetch website +    │         │ Score fit         │
   │ /contact (HTML→txt)│         │ (AI feature       │
   └─────────┬──────────┘         │  classify_lead_fit)│
             │                    └─────────┬─────────┘
             ▼                              │
   ┌────────────────────┐                   │
   │ AI extract email/  │                   │
   │ social/desc        │                   │
   │ (enrich_company_   │                   │
   │  from_website)     │                   │
   └─────────┬──────────┘                   │
             │                              │
             └──────────┬───────────────────┘
                        ▼
              ┌──────────────────────┐
              │  Update company      │
              │  state: 'enriched'   │
              │  emit timeline event │
              └──────────────────────┘
```

## Google Places API (New) details

### Endpoint

```
POST https://places.googleapis.com/v1/places:searchText
Headers:
  X-Goog-Api-Key: <google_maps_places_key>
  X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,
                    places.location,places.types,places.primaryType,
                    places.nationalPhoneNumber,places.internationalPhoneNumber,
                    places.websiteUri,places.googleMapsUri,
                    places.rating,places.userRatingCount,
                    places.businessStatus,places.regularOpeningHours,
                    places.photos
```

### Body

```json
{
  "textQuery": "pharmacies in Mombasa",
  "languageCode": "en",
  "regionCode": "KE",
  "pageSize": 60,
  "locationBias": {
    "circle": {
      "center": { "latitude": -4.0435, "longitude": 39.6682 },
      "radius": 50000
    }
  }
}
```

### FieldMask discipline

Each field family costs differently. We always request **Essentials + Pro** tier only (`id`, name, address, location, types, opening hours, contact, photos). Never request reviews or Enterprise-tier fields. This keeps each call to ~$0.017.

### Pagination

If `nextPageToken` returned and user wants more, second call costs another $0.017. Atlas caps at 3 pages (180 results) per search unless user explicitly continues.

## Schema additions for Prospector

Already in `05-data-model.md`. Specific Prospector fields on `companies`:

- `google_place_id` (unique per workspace)
- `enriched_at`
- `enrichment_data` (jsonb — raw Places + scraped HTML highlights)
- `fit_score` (0–100)
- `source = 'prospector'`

New table for searches (so you can re-open a past search):

```ts
prospector_searches {
  id              uuid pk
  workspace_id    uuid fk
  query           text         // "pharmacies in Mombasa"
  location_bias   jsonb null   // lat/lng/radius or null
  language_code   text         // 'en' or 'sw'
  region_code     text         // 'KE'
  result_count    int
  cost_usd        numeric(8,4) // $0.017 per page × pages
  pages_fetched   int
  initiated_by    uuid fk → user.id
  created_at      timestamptz
}

prospector_search_results {
  id              uuid pk
  search_id       uuid fk → prospector_searches.id on delete cascade
  company_id      uuid fk → companies.id
  position        int          // rank in results
  raw_payload     jsonb        // the Places API result row
  created_at      timestamptz

  unique (search_id, company_id)
}
```

## Enrichment job (`enrich-company`)

Triggered per company in pg-boss with backoff. Steps:

1. **Skip if `enriched_at < 30 days ago`** (already enriched, don't re-spend).
2. **Fetch website HTML** if `companies.domain` is set:
   - HEAD then GET, timeout 10s, max 1MB body
   - Strip scripts/styles → text via `cheerio`
   - Look for `/contact`, `/about`, `/team` links — fetch up to 3 additional pages
3. **AI extract** (`enrich_company_from_website` feature, default Gemini Flash Lite):
   - Input: combined text (capped at 16K tokens)
   - Output (Zod schema):
     ```ts
     {
       primaryEmail?: string;       // best contact email
       additionalEmails: string[];  // others found
       socials: {
         instagram?: string;
         twitter?: string;
         facebook?: string;
         linkedin?: string;
         tiktok?: string;
       };
       businessDescription: string;    // 1-sentence what they do
       businessType: string;           // 'pharmacy' | 'hardware' | …
       offersOnline: boolean;          // do they have online ordering?
       hasContactForm: boolean;
     }
     ```
4. **Phone normalization** (local code):
   - Parse `internationalPhoneNumber` → E.164 via `libphonenumber-js`
   - Default region: workspace setting (KE)
   - Set `whatsapp = phone` if the number is mobile (Kenya: starts with 254[71][0-9])
5. **AI fit score** (`classify_lead_fit`):
   - Input: company name + description + business type + workspace context (e.g., "We sell POS software to pharmacies")
   - Output: integer 0–100 + 1-sentence reason
6. **Update company:** `enriched_at`, `enrichment_data` jsonb, `fit_score`
7. **Emit timeline event:** `contact_enriched` / `company_enriched`

If any step fails: retry 3 times with exponential backoff, then mark `enrichment_status='failed'` and surface in UI.

## UI

### Search page (`/prospector`)

Three sections, top to bottom:

**1. Search bar** — single input + advanced toggles (location/radius/language/region). Keyboard `⌘K`-style autocomplete.

**2. Results pane (split):**
- Left: table with columns: name, type, fit score, phone (with WhatsApp icon if applicable), email status (✓ or "—"), rating, distance from bias center, action chip
- Right: map (MapLibre GL) — pins for each result, click pin → highlight row, click row → center map on pin

Selecting rows (Shift+click range, Cmd+click toggle) enables bulk-action toolbar:

- **Import to pipeline** → pick pipeline + stage (default: Cold) + bulk-tag
- **Suppress** → adds to suppression list, removes from view
- **Generate first-touch** → opens drafts pane (see below)
- **Export CSV** → for offline use

**3. Past searches** — table of `prospector_searches`, click to re-open and see results without re-paying Google.

### Drafts pane

For each selected company, AI generates a personalized first-touch:

- **Email draft** (if email found): subject + body, using workspace template "First-touch — cold outreach" + company-specific personalization
- **WhatsApp draft** (always): short message using workspace WhatsApp template + free-form personalization (if within 24h window, free-form only is fine)

User reviews each in a stacked list. Approve / edit / skip. "Approve all" sends in queue with rate limit (e.g., 1 per 5 seconds to avoid spam flags).

### Map view

MapLibre GL + free OpenFreeMap tiles. Custom pin style (sharp marker, accent color for high-fit, muted for low-fit). Cluster pins above 50 results. Click pin → highlight row + show mini-card with name + fit score + "Open" button (slide-over).

## Suppression

```ts
prospector_suppressions {
  id              uuid pk
  workspace_id    uuid fk
  google_place_id text null
  domain          text null
  email           text null
  phone           text null
  reason          text          // 'not_a_fit' | 'already_customer' | 'opted_out' | 'manual'
  added_by        uuid fk → user.id
  created_at      timestamptz

  index idx_suppress_workspace on (workspace_id)
  unique (workspace_id, google_place_id) where google_place_id not null
  unique (workspace_id, email) where email not null
  unique (workspace_id, phone) where phone not null
}
```

Filtered out of every Prospector search by `place_id`, `domain`, `email`, or `phone` match.

## Rate limits + safeguards

- **Per-org daily quota:** default 200 searches/day. Configurable.
- **Per-search cap:** max 3 pages (180 results) unless user clicks "Get more"
- **Outreach rate limit:** Atlas queues sends — 1 per 5 sec for email, per Meta tier for WhatsApp (250 / 1K / 10K conversations per 24h depending on Meta tier)
- **Email validation:** AI-extracted emails are validated (format, MX record check) before saving — bad emails saved with `email_valid=false` and not used for outreach
- **WhatsApp opt-in compliance:** initial outbound uses Meta-approved utility/marketing template (template manager submits + polls); free-form only after lead replies

## Keyboard

- `g` → Prospector
- `/` → focus search bar
- `Enter` → run search
- `j`/`k` → table nav
- `Space` → toggle selection
- `Shift+J/K` → range select
- `Shift+I` → import selected
- `Shift+G` → generate drafts for selected
- `s` → suppress selected

## Acceptance (end of Phase 3 — the Prospector phase)

- [ ] Org Owner pastes Google Maps API key, test succeeds
- [ ] Search "pharmacies in Nairobi" returns ≥ 40 results within 3s
- [ ] Each result becomes a company row with `source='prospector'`
- [ ] Background enrichment runs, fills emails/socials for ≥ 60% of results
- [ ] Phone numbers normalized to E.164 with WhatsApp flag
- [ ] AI fit score appears within 30s per company
- [ ] Map view shows pins, clicking pin highlights row
- [ ] Bulk-select + import to pipeline works
- [ ] First-touch drafts (email + WhatsApp) generated for selected
- [ ] Suppression of a company removes it from future searches
- [ ] Past searches list re-opens with cached results (no new Google call)
- [ ] Cost tracker shows total spent vs Google free credit remaining
