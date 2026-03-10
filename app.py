import os
import io
import fitz  # PyMuPDF
import base64
import json
from fastapi import FastAPI, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import tempfile
import uuid
import asyncio
from dotenv import load_dotenv
from openai import AsyncOpenAI
    
load_dotenv(override=True)
openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Global progress tracking
extraction_progress: Dict[str, Any] = {
    "total": 0,
    "completed": 0,
    "stage": "Idle"
}

app = FastAPI(title="PDF Area Extractor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = tempfile.gettempdir()

# Mount frontend static files
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# --- Pydantic Models ---
class Region(BaseModel):
    id: str
    x0: float
    y0: float
    x1: float
    y1: float

class PageExtractionRequest(BaseModel):
    page_index: int
    regions: List[Region]

class ExtractRequest(BaseModel):
    file_id: str
    pages: List[PageExtractionRequest]

class SmartDuplicateRequest(BaseModel):
    file_id: str
    source_page_index: int
    target_pages: List[int]
    source_regions: List[Region]

# --- Helpers ---
def get_page_image_base64(doc: fitz.Document, page_index: int, zoom: float = 2.0) -> str:
    page = doc[page_index]
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat)
    img_bytes = pix.tobytes("png")
    return base64.b64encode(img_bytes).decode('utf-8')

async def process_text_to_table(text: str) -> List[Dict[str, Any]]:
    if not text.strip() or not openai_client.api_key:
        return []
    try:
        response = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a data parsing assistant. I will give you OCR/raw text from a document. Your job is to parse it into a structured data table suitable for a database. Return ONLY a valid JSON array of objects (e.g., `[{\"Column1\": \"Value1\", \"Column2\": \"Value2\"}]`). Infer the column names from the text context if headers exist. Do NOT include markdown formatting or backticks like ```json."},
                {"role": "user", "content": text}
            ],
            temperature=0.1
        )
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        return json.loads(content)
    except Exception as e:
        print("OpenAI Error:", e)
        return []

async def analyze_smart_bounds(source_content: str, target_content: str) -> List[int]:
    """Uses LLM to match the source region's intent with target page elements."""
    prompt = f"""
You are an intelligent document layout assistant.
A user has drawn a bounding box around the following content on Page A:
--- SOURCE CONTENT ---
{source_content}
----------------------

Now, look at all the available text blocks on Page B, labeled by index:
--- TARGET CONTENT ---
{target_content}
----------------------

Identify which items on Page B logically correspond to the user's selection on Page A.
Return ONLY a JSON list of integer indices. Example: [0, 1, 2]
"""
    try:
        response = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful data extraction assistant that only outputs valid JSON arrays of integers."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.0
        )
        content = response.choices[0].message.content
        if "```" in content:
            content = content.replace("```json", "").replace("```", "").strip()
        indices = json.loads(content)
        return indices if isinstance(indices, list) else []
    except Exception as e:
        print(f"OpenAI Smart Match Error: {e}")
        return []

# --- Routes ---

@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """Uploads a PDF, saves it, and returns the first page image and total pages."""
    if not file.filename.lower().endswith('.pdf'):
        return JSONResponse(status_code=400, content={"error": "File must be a PDF"})
    
    file_id = str(uuid.uuid4())
    pdf_path = os.path.join(UPLOAD_DIR, f"{file_id}.pdf")
    
    with open(pdf_path, "wb") as f:
        f.write(await file.read())
        
    try:
        doc = fitz.open(pdf_path)
        if len(doc) == 0:
            return JSONResponse(status_code=400, content={"error": "PDF has no pages"})
        
        page = doc[0]
        pdf_width = page.rect.width
        pdf_height = page.rect.height
        
        img_base64 = get_page_image_base64(doc, 0)
        total_pages = len(doc)
        doc.close()
        
        return {
            "file_id": file_id,
            "total_pages": total_pages,
            "pdf_width": pdf_width,
            "pdf_height": pdf_height,
            "image": f"data:image/png;base64,{img_base64}"
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/page/{file_id}/{page_index}")
async def get_page(file_id: str, page_index: int):
    """Fetches a specific page image for navigation."""
    pdf_path = os.path.join(UPLOAD_DIR, f"{file_id}.pdf")
    if not os.path.exists(pdf_path):
        return JSONResponse(status_code=404, content={"error": "File not found."})
        
    try:
        doc = fitz.open(pdf_path)
        if page_index < 0 or page_index >= len(doc):
            doc.close()
            return JSONResponse(status_code=400, content={"error": "Invalid page index."})
            
        page = doc[page_index]
        pdf_width = page.rect.width
        pdf_height = page.rect.height
        
        img_base64 = get_page_image_base64(doc, page_index)
        doc.close()
        
        return {
            "page_index": page_index,
            "pdf_width": pdf_width,
            "pdf_height": pdf_height,
            "image": f"data:image/png;base64,{img_base64}"
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/")
async def read_root():
    from fastapi.responses import FileResponse
    return FileResponse("static/index.html")

@app.get("/api/progress")
async def get_progress():
    """Returns the current progress of extraction."""
    return extraction_progress

@app.post("/api/smart_duplicate")
async def smart_duplicate(req: SmartDuplicateRequest):
    """
    Intelligently resizes source regions on target pages.
    Strategy:
    1. Geometrically copy source regions to target pages (same position).
    2. For each region, try to find a TABLE on the target page in the same column range.
       If found, snap the region bounds to fully cover the entire table.
    3. If no table, find the cluster of text blocks in the same column range and expand to cover those.
    This is purely structural (no AI needed), making it fast and accurate.
    """
    pdf_path = os.path.join(UPLOAD_DIR, f"{req.file_id}.pdf")
    if not os.path.exists(pdf_path):
        return JSONResponse(status_code=404, content={"error": "File not found."})
    if not req.source_regions:
        return JSONResponse(status_code=400, content={"error": "No source regions provided."})

    try:
        doc = fitz.open(pdf_path)
        results = []
        PAD = 4.0  # padding around detected bounds
        COL_TOLERANCE = 20.0  # horizontal tolerance for column matching (pts)

        for p_idx in req.target_pages:
            if p_idx < 0 or p_idx >= len(doc):
                continue

            target_page = doc[p_idx]
            page_w = float(target_page.rect.width)
            page_h = float(target_page.rect.height)

            # Detect all tables on the page
            found_tables = []
            try:
                tab_result = target_page.find_tables()
                if tab_result and tab_result.tables:
                    for tbl in tab_result.tables:
                        bb = tbl.bbox  # (x0, y0, x1, y1)
                        found_tables.append(bb)
            except Exception:
                found_tables = []

            # Get all text blocks
            blocks = target_page.get_text("blocks")
            text_blocks = [b for b in blocks if b[6] == 0 and b[4].strip()]

            page_regions = []

            for r in req.source_regions:
                src_x0 = float(r.x0)
                src_x1 = float(r.x1)
                src_y0 = float(r.y0)
                src_y1 = float(r.y1)
                col_x0 = src_x0 - COL_TOLERANCE
                col_x1 = src_x1 + COL_TOLERANCE

                # --- Try to snap to a table in the same column ---
                matching_tables = [
                    t for t in found_tables
                    # table must overlap horizontally with source region column
                    if t[2] > col_x0 and t[0] < col_x1
                ]

                if matching_tables:
                    # Use the table whose horizontal centre is closest to the source region centre
                    src_cx = (src_x0 + src_x1) / 2.0
                    best = min(matching_tables, key=lambda t: abs((t[0] + t[2]) / 2.0 - src_cx))
                    new_x0 = max(0.0, best[0] - PAD)
                    new_y0 = max(0.0, best[1] - PAD)
                    new_x1 = min(page_w, best[2] + PAD)
                    new_y1 = min(page_h, best[3] + PAD)
                    page_regions.append({
                        "id": r.id,
                        "x0": new_x0, "y0": new_y0,
                        "x1": new_x1, "y1": new_y1
                    })
                    continue

                # --- Fallback: snap to text block cluster in same column ---
                col_blocks = [
                    b for b in text_blocks
                    if b[2] > col_x0 and b[0] < col_x1
                ]

                if col_blocks:
                    new_x0 = max(0.0, min(b[0] for b in col_blocks) - PAD)
                    new_y0 = max(0.0, min(b[1] for b in col_blocks) - PAD)
                    new_x1 = min(page_w, max(b[2] for b in col_blocks) + PAD)
                    new_y1 = min(page_h, max(b[3] for b in col_blocks) + PAD)
                    page_regions.append({
                        "id": r.id,
                        "x0": new_x0, "y0": new_y0,
                        "x1": new_x1, "y1": new_y1
                    })
                else:
                    # Last resort — geometrically clip source region to page bounds
                    page_regions.append({
                        "id": r.id,
                        "x0": max(0.0, min(src_x0, page_w)),
                        "y0": max(0.0, min(src_y0, page_h)),
                        "x1": max(0.0, min(src_x1, page_w)),
                        "y1": max(0.0, min(src_y1, page_h))
                    })

            results.append({"page_index": p_idx, "regions": page_regions})

        doc.close()
        return {"success": True, "results": results}

    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/extract")
async def extract_areas(req: ExtractRequest):
    """Extracts text and tables, then runs AI structuring concurrently."""
    global extraction_progress
    
    pdf_path = os.path.join(UPLOAD_DIR, f"{req.file_id}.pdf")
    if not os.path.exists(pdf_path):
        return JSONResponse(status_code=404, content={"error": "File not found. Please upload again."})
    if not req.pages:
        return JSONResponse(status_code=400, content={"error": "No pages selected for extraction."})

    try:
        doc = fitz.open(pdf_path)
        results: List[Dict[str, Any]] = []
        total_pages = len(req.pages)
        
        # Reset progress  
        extraction_progress = {"total": total_pages, "completed": 0, "stage": "Starting..."}
        
        # --- PHASE 1: Fast native text extraction (page by page) ---
        regions_for_ai: List[tuple] = []  # (region_dict, raw_text)
        
        for p_req in req.pages:
            p_idx = p_req.page_index
            if p_idx < 0 or p_idx >= len(doc):
                continue
                
            page = doc[p_idx]
            page_data: Dict[str, Any] = {"page_index": p_idx, "regions": []}
            
            for region in p_req.regions:
                rect = fitz.Rect(region.x0, region.y0, region.x1, region.y1)
                raw_text = page.get_textbox(rect)
                
                # Native table extraction
                tables_found = page.find_tables(clip=rect)
                extracted_tables = []
                if tables_found and tables_found.tables:
                    for tbl in tables_found.tables:
                        extracted_tables.append(tbl.extract())
                
                region_dict: Dict[str, Any] = {
                    "region_id": region.id,
                    "text": raw_text,
                    "tables": extracted_tables,
                    "ai_table": []
                }
                
                if raw_text.strip():
                    regions_for_ai.append((region_dict, raw_text))
                
                page_data["regions"].append(region_dict)
            
            results.append(page_data)
            extraction_progress["completed"] += 1
            extraction_progress["stage"] = f"Page {extraction_progress['completed']}/{total_pages} extracted"
        
        doc.close()
        
        # --- PHASE 2: Concurrent AI structuring ---
        if regions_for_ai:
            ai_total = len(regions_for_ai)
            extraction_progress["total"] = ai_total
            extraction_progress["completed"] = 0
            extraction_progress["stage"] = f"AI structuring 0/{ai_total} regions..."
            
            async def ai_task(r_dict: Dict[str, Any], text: str) -> None:
                result = await process_text_to_table(text)
                r_dict["ai_table"] = result
                extraction_progress["completed"] += 1
                extraction_progress["stage"] = f"AI structured {extraction_progress['completed']}/{ai_total} regions"
            
            await asyncio.gather(*[ai_task(rd, rt) for rd, rt in regions_for_ai])
        
        extraction_progress["stage"] = "Done"
        
        return {"success": True, "results": results}
        
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

if __name__ == "__main__":
    import uvicorn
    os.makedirs("static", exist_ok=True)
    uvicorn.run(app, host="127.0.0.1", port=8000)
