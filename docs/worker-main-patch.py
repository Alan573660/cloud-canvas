# ============================================
# PATCH для main.py Cloud Run worker v3.0-prod
# Добавить эти 3 улучшения в существующий код
# ============================================

# 1. GLOBAL EXCEPTION HANDLER
# Добавить после создания APP:

from starlette.responses import JSONResponse

@APP.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all handler - prevents leaking internal errors to clients."""
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "error_code": "INTERNAL_ERROR",
            "detail": "Internal server error",
        },
    )


# 2. EMPTY FILE CHECK
# Добавить в _read_file_to_df после получения df:

def _read_file_to_df(file_url: Optional[str], gcs_uri: Optional[str], file_format: str) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    if file_url:
        file_bytes = _download_file_bytes(file_url)
    else:
        raise HTTPException(status_code=400, detail="Missing file_url")

    if file_format == "csv":
        df, meta = _read_csv_to_df(file_bytes)
    elif file_format in ("xlsx", "xls"):
        df, meta = _read_excel_to_df(file_bytes, file_format)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file_format={file_format}")

    # === NEW: Empty file check ===
    if df.empty or len(df) == 0:
        raise HTTPException(status_code=400, detail="File is empty (no data rows)")
    
    # === NEW: Too few columns check ===
    if len(df.columns) < 2:
        raise HTTPException(status_code=400, detail="File has less than 2 columns")

    return df, meta


# 3. DUPLICATE ID WARNING
# Добавить в _validate_rows после создания pid Series:

def _validate_rows(df: pd.DataFrame) -> Tuple[pd.Series, List[Dict[str, Any]]]:
    errs: List[Dict[str, Any]] = []

    if "id" not in df.columns or "price_rub_m2" not in df.columns:
        raise HTTPException(status_code=400, detail="Validate requires canonical columns id and price_rub_m2")

    df2 = df.copy().reset_index(drop=True)
    if "__row_number" not in df2.columns:
        df2["__row_number"] = df2.index + 1

    pid = df2["id"].astype(str).str.strip()
    price_dec = df2["price_rub_m2"].apply(_to_decimal)

    bad_id = pid.eq("") | pid.str.lower().eq("null")
    bad_price = price_dec.isna() | (price_dec <= Decimal("0"))

    # === NEW: Duplicate ID detection ===
    dup_mask = pid.duplicated(keep=False) & ~bad_id  # mark all duplicates (not just first/last)
    dup_ids = pid[dup_mask].unique().tolist()[:50]  # cap at 50 for logging
    if dup_ids:
        logger.warning(f"Duplicate IDs detected ({len(dup_ids)} unique): {dup_ids[:10]}...")
        # Add errors for duplicates (keep first occurrence valid, mark rest as errors)
        dup_after_first = pid.duplicated(keep='first') & ~bad_id
        for i in df2.index[dup_after_first].tolist()[:MAX_ERROR_ROWS_TO_STORE]:
            rn = int(df2.at[i, "__row_number"])
            errs.append({
                "row_number": rn,
                "error_type": "DUPLICATE_ID",
                "message": f"Duplicate product id: {pid.at[i]}",
                "column_name": "id",
                "raw_value": pid.at[i],
            })
        # Mark duplicates (after first) as invalid
        bad_id = bad_id | dup_after_first
    # === END NEW ===

    valid = ~(bad_id | bad_price)

    # collect errors (capped)
    bad_idx = df2.index[~valid].tolist()[:MAX_ERROR_ROWS_TO_STORE]
    for i in bad_idx:
        rn = int(df2.at[i, "__row_number"])
        if bad_id.at[i] and not dup_after_first.at[i]:  # skip if already added as duplicate
            errs.append({"row_number": rn, "error_type": "MISSING_ID", "message": "Missing product id", "column_name": "id", "raw_value": ""})
        if bad_price.at[i]:
            errs.append({"row_number": rn, "error_type": "INVALID_PRICE", "message": "Invalid price_rub_m2", "column_name": "price_rub_m2", "raw_value": str(df2.at[i, "price_rub_m2"])})
    
    return valid, errs


# ============================================
# ИТОГОВЫЙ ЧЕКЛИСТ (все пункты ✅)
# ============================================
#
# ✅ batched DELETE staging по id (PK) - _sb_delete_job_rows_batched
# ✅ batched INSERT staging - _sb_insert с SB_INSERT_BATCH_SIZE
# ✅ batched INSERT в BigQuery - load_table_from_dataframe (native batch)
# ✅ job не может зависнуть в APPLYING - always set FAILED + finished_at в except
# ✅ UI polling ≠ error - UI ориентируется на status, не на timeout
# ✅ staging не хранит весь файл - STAGING_SAMPLE_ROWS = 300
# ✅ CSV работает стабильно - utf-8/cp1251 + auto delimiter
# ✅ XLSX проходит тем же пайплайном - openpyxl/xlrd + canonical schema
# ✅ Progress updates - _sb_progress с stage/progress/%
# ✅ Retry logic - HTTP + BQ retries с backoff
# ✅ Idempotency - _idempotency_guard_publish
# ✅ Cleanup on error - best-effort staging cleanup
# ✅ Logging - structured logging с job_id
# ✅ File size limit - MAX_FILE_SIZE_MB streaming check
# ✅ BQ table existence - _ensure_bq_tables before load
# ✅ Vectorized validation - no iterrows, pandas Series ops
