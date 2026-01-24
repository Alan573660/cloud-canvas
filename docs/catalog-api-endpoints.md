# BigQuery Catalog API Endpoints

Эндпоинты для Cloud Run (pricing-api-saas / FastAPI).

## GET /api/catalog/items

Получение списка товаров из BigQuery с пагинацией и фильтрами.

### Query Parameters

| Parameter       | Type    | Required | Description                          |
|-----------------|---------|----------|--------------------------------------|
| organization_id | string  | ✅       | UUID организации                     |
| page            | int     | ❌       | Номер страницы (default: 1)          |
| page_size       | int     | ❌       | Размер страницы (default: 15, max: 100) |
| search          | string  | ❌       | Поиск по sku, title, profile         |
| profile         | string  | ❌       | Фильтр по профилю                    |
| coating         | string  | ❌       | Фильтр по покрытию                   |
| thickness_mm    | float   | ❌       | Фильтр по толщине                    |
| is_active       | bool    | ❌       | Фильтр по активности (from Supabase) |

### Response

```json
{
  "items": [
    {
      "bq_id": "org_123_sku_456",
      "sku": "МП-20-045-ПЭ",
      "title": "Металлопрофиль МП-20",
      "profile": "МП-20",
      "coating": "Полиэстер",
      "thickness_mm": 0.45,
      "width_work_mm": 1100,
      "width_full_mm": 1150,
      "weight_kg_m2": 4.2,
      "base_price_rub_m2": 450.00,
      "unit": "m2",
      "currency": "RUB",
      "notes": null,
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-20T15:30:00Z"
    }
  ],
  "total_count": 71316,
  "page": 1,
  "page_size": 15,
  "has_next": true
}
```

### BigQuery SQL

```sql
SELECT
  CONCAT(org_id, '_', sku) AS bq_id,
  sku,
  title,
  profile,
  coating,
  thickness_mm,
  width_work_mm,
  width_full_mm,
  weight_kg_m2,
  base_price AS base_price_rub_m2,
  unit,
  currency AS cur,
  notes,
  created_at,
  updated_at
FROM `roofing_saas.master_products_current`
WHERE org_id = @organization_id
  AND (
    @search IS NULL 
    OR LOWER(sku) LIKE CONCAT('%', LOWER(@search), '%')
    OR LOWER(title) LIKE CONCAT('%', LOWER(@search), '%')
    OR LOWER(profile) LIKE CONCAT('%', LOWER(@search), '%')
  )
  AND (@profile IS NULL OR profile = @profile)
  AND (@coating IS NULL OR coating = @coating)
  AND (@thickness_mm IS NULL OR thickness_mm = @thickness_mm)
ORDER BY profile, thickness_mm, base_price
LIMIT @page_size OFFSET @offset
```

---

## GET /api/catalog/facets

Получение уникальных значений для фильтров.

### Query Parameters

| Parameter       | Type   | Required | Description      |
|-----------------|--------|----------|------------------|
| organization_id | string | ✅       | UUID организации |

### Response

```json
{
  "profiles": ["МП-20", "С-8", "С-21", "НС-35", "Н-60"],
  "coatings": ["Полиэстер", "Пурал", "ПВДФ", "Оцинковка"],
  "thicknesses": [0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8]
}
```

### BigQuery SQL

```sql
-- Profiles
SELECT DISTINCT profile FROM `roofing_saas.master_products_current`
WHERE org_id = @organization_id AND profile IS NOT NULL
ORDER BY profile;

-- Coatings
SELECT DISTINCT coating FROM `roofing_saas.master_products_current`
WHERE org_id = @organization_id AND coating IS NOT NULL
ORDER BY coating;

-- Thicknesses
SELECT DISTINCT thickness_mm FROM `roofing_saas.master_products_current`
WHERE org_id = @organization_id AND thickness_mm IS NOT NULL
ORDER BY thickness_mm;
```

---

## Supabase Overrides

Для управления `is_active` и другими override-полями используется таблица `product_catalog` в Supabase.

### Upsert Override

```sql
INSERT INTO product_catalog (organization_id, bq_key, is_active, sku, base_price_rub_m2)
VALUES ($org_id, $bq_id, $is_active, $bq_id, 0)
ON CONFLICT (organization_id, bq_key) 
DO UPDATE SET is_active = $is_active, updated_at = now();
```

### Fetch Overrides for Page

```sql
SELECT bq_key, is_active
FROM product_catalog
WHERE organization_id = $org_id
  AND bq_key IN ($bq_id_1, $bq_id_2, ...);
```

---

## Environment Variables

```env
# Frontend (.env)
VITE_CATALOG_API_URL=https://pricing-api-saas-XXXXX.run.app

# Cloud Run (pricing-api-saas)
BQ_PROJECT_ID=your-gcp-project
BQ_DATASET=roofing_saas
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```
