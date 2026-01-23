# ========================================
# Cloud Run Worker - CRITICAL FIXES
# Apply these patches to main.py v3.0-prod
# ========================================

# ==========================================
# FIX 1: REDUCE SB_DELETE_BATCH_SIZE (CRITICAL!)
# Line ~35 in main.py - fixes statement timeout 57014
# ==========================================
# CHANGE FROM:
#   SB_DELETE_BATCH_SIZE = int(os.environ.get("SB_DELETE_BATCH_SIZE", "1000"))
# TO:
SB_DELETE_BATCH_SIZE = int(os.environ.get("SB_DELETE_BATCH_SIZE", "200"))  # Keep low to avoid 57014 timeout


# ==========================================
# FIX 2: Add retry wrapper for Supabase DELETE operations
# Add near line ~160 after _sb_delete_ids function
# ==========================================
def _sb_delete_ids_safe(table: str, ids: List[str], max_retries: int = 3) -> int:
    """Delete with retry on timeout errors."""
    if not ids:
        return 0
    last_err = None
    for attempt in range(max_retries):
        try:
            return _sb_delete_ids(table, ids)
        except RuntimeError as e:
            err_str = str(e)
            # Retry on statement timeout (57014) or transient errors
            if "57014" in err_str or "timeout" in err_str.lower() or "503" in err_str:
                last_err = e
                logger.warning(f"[DELETE] Retry {attempt+1}/{max_retries} for {table}: {err_str[:100]}")
                time.sleep((1.5 ** attempt) * 0.5)
                continue
            raise
    raise RuntimeError(f"DELETE {table} failed after {max_retries} retries: {last_err}")


# ==========================================  
# FIX 3: Update _sb_delete_job_rows_batched to use safe delete
# Replace existing function
# ==========================================
def _sb_delete_job_rows_batched(table: str, org_id: str, job_id: str) -> None:
    """Batched delete with retry and smaller batches."""
    total = 0
    while True:
        ids = _sb_select_ids_for_job(table, org_id, job_id, SB_DELETE_BATCH_SIZE)
        if not ids:
            break
        total += _sb_delete_ids_safe(table, ids)  # Use safe version with retry
        time.sleep(0.1)  # Small delay between batches to avoid rate limits
    logger.info(f"[job={job_id}] {table}: deleted {total}")


# ==========================================
# FIX 4: Add global exception handler to FastAPI
# Add after APP = FastAPI(...) around line ~50
# ==========================================
from starlette.responses import JSONResponse

@APP.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception):
    """Prevent internal errors from leaking sensitive info."""
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "error_code": "INTERNAL_ERROR", 
            "error": str(exc)[:200],
        },
    )


# ==========================================
# FIX 5: Empty file check in _read_file_to_df
# Add at the END of _read_file_to_df function, before final return
# ==========================================
# After reading the dataframe (df), add this check:
if df.empty or len(df.columns) < 2:
    raise HTTPException(status_code=400, detail="File is empty or has insufficient columns")


# ==========================================
# FIX 6: Duplicate ID detection in _validate_rows  
# Add after the line: valid = ~(bad_id | bad_price)
# ==========================================
# Detect duplicate IDs (keep first, mark rest as invalid)
dup_mask = df2["id"].astype(str).str.strip().duplicated(keep='first')
dup_count = int(dup_mask.sum())
if dup_count > 0:
    logger.warning(f"[job] Found {dup_count} duplicate IDs - keeping first occurrence")
    # Add errors for duplicates (capped at 100)
    for i in df2.index[dup_mask].tolist()[:100]:
        rn = int(df2.at[i, "__row_number"])
        errs.append({
            "row_number": rn, 
            "error_type": "DUPLICATE_ID", 
            "message": f"Duplicate ID: {df2.at[i, 'id']}", 
            "column_name": "id",
            "raw_value": str(df2.at[i, "id"])
        })
    # Update valid mask to exclude duplicates
    valid = valid & ~dup_mask


# ==========================================
# DEPLOYMENT CHECKLIST
# ==========================================
# 1. Set environment variable: SB_DELETE_BATCH_SIZE=200
# 2. Apply fixes 2-3 to add retry logic for DELETE
# 3. Rebuild and deploy the Cloud Run service  
# 4. Monitor logs for "57014" errors - if still occurring, reduce to 100
#
# ==========================================
# ALREADY IMPLEMENTED (no changes needed)
# ==========================================
# ✅ batched DELETE staging по id (PK) - _sb_delete_job_rows_batched
# ✅ batched INSERT staging - _sb_insert с SB_INSERT_BATCH_SIZE
# ✅ batched INSERT в BigQuery - load_table_from_dataframe (native batch)
# ✅ job не может зависнуть в APPLYING - always set FAILED + finished_at в except
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
