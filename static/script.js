document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const pdfUpload = document.getElementById('pdf-upload');
    const imageWrapper = document.getElementById('image-wrapper');
    const zoomWrapper = document.getElementById('zoom-wrapper');
    const pdfImage = document.getElementById('pdf-image');

    // UI Controls
    const emptyState = document.getElementById('empty-state');
    const toolbar = document.getElementById('toolbar');
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    const extractionActions = document.getElementById('extraction-actions');
    const extractBtn = document.getElementById('extract-btn');
    const clearBtn = document.getElementById('clear-btn');
    const resultsPanel = document.getElementById('results-panel');
    const closeResultsBtn = document.getElementById('close-results');
    const exportCsvBtn = document.getElementById('export-csv-btn');

    // Pagination & Zoom
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageIndicator = document.getElementById('page-indicator');
    const zoomInBtn = document.getElementById('zoom-in');
    const zoomOutBtn = document.getElementById('zoom-out');
    const zoomResetBtn = document.getElementById('zoom-reset');
    const zoomLevelTxt = document.getElementById('zoom-level');

    // Features
    const duplicateToggle = document.getElementById('duplicate-pages-toggle');
    const exclusionsContainer = document.getElementById('page-exclusions-container');
    const pageListContent = document.getElementById('page-list');
    const selectionCountTxt = document.getElementById('selection-count');
    const refreshBtn = document.getElementById('refresh-btn');
    const panelResizer = document.getElementById('panel-resizer');
    const floatingResultsBtn = document.getElementById('floating-results-btn');

    // Page Selection Modifiers
    const btnSelectAll = document.getElementById('btn-select-all');
    const btnSelectNone = document.getElementById('btn-select-none');
    const btnSelectOdd = document.getElementById('btn-select-odd');
    const btnSelectEven = document.getElementById('btn-select-even');
    const btnAiSmartMatch = document.getElementById('ai-smart-match-btn');

    // Tabs
    const tabs = document.querySelectorAll('.tab');
    const tabPanes = document.querySelectorAll('.tab-pane');

    // State
    let fileId = null;
    let totalPages = 0;
    let currentPageIndex = 0;
    let pdfRealWidth = 0;
    let pdfRealHeight = 0;
    let zoomLevel = 1.0;

    // Drawing State
    let isDrawing = false;
    let startX = 0;
    let startY = 0;
    const drawingBox = document.getElementById('drawing-box');

    // Data structures
    // selections[pageIndex] = [ { id, x0, y0, w, h, pdfX0, pdfY0, pdfX1, pdfY1 } ]
    let selectionsByPage = {};
    let boxCounter = 0;
    let lastExtractionResults = null;

    // Box editing state
    let isDraggingBox = false;
    let isResizingBox = false;
    let activeBoxIdx = null;
    let dragStartX, dragStartY;
    let boxStartLeft, boxStartTop, boxStartWidth, boxStartHeight;

    // --- 0. APP LEVEL CONTROLS ---
    refreshBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to reset everything?")) {
            window.location.reload();
        }
    });

    let isResizing = false;
    let startPanelHeight = 0;
    let startMouseY = 0;

    panelResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startMouseY = e.clientY;
        startPanelHeight = resultsPanel.offsetHeight;
        document.body.style.cursor = 'ns-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const dy = startMouseY - e.clientY;
        const newHeight = startPanelHeight + dy;
        // constrain height
        if (newHeight > 100 && newHeight < window.innerHeight * 0.9) {
            resultsPanel.style.height = `${newHeight}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
        }
    });

    // Placeholder for toggleResultsPanel if it's not defined elsewhere
    function toggleResultsPanel(show) {
        if (show) {
            resultsPanel.classList.remove('hidden');
        } else {
            resultsPanel.classList.add('hidden');
        }
    }

    // --- 1. UPLOAD LOGIC ---
    // Assuming pdfUpload is the file input element
    // uploadBtn.addEventListener('click', () => pdfUpload.click()); // If there was a separate button

    pdfUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Reset state
        fileId = null;
        totalPages = 0;
        currentPageIndex = 0;
        selectionsByPage = {};
        boxCounter = 0;
        toggleResultsPanel(false);
        renderBoxesForCurrentPage(); // Clear any existing boxes from previous upload

        const formData = new FormData();
        formData.append('file', file);

        showLoader("Uploading and processing PDF...");

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (res.ok) {
                fileId = data.file_id;
                totalPages = data.total_pages;
                pdfRealWidth = data.pdf_width;
                pdfRealHeight = data.pdf_height;

                pdfImage.src = data.image;
                pdfImage.onload = () => {
                    emptyState.classList.add('hidden');
                    imageWrapper.classList.remove('hidden');
                    toolbar.classList.remove('hidden'); // Kept from original
                    extractionActions.classList.remove('hidden'); // Kept from original
                    updatePaginationUI();
                    buildExclusionList();
                    renderBoxesForCurrentPage();
                    hideLoader();
                }
            } else {
                alert(`Error: ${data.error}`);
                hideLoader();
            }
        } catch (e) {
            alert(`Upload failed: ${e.message}`);
            hideLoader();
        }
    });

    // --- 2. PAGINATION LOGIC ---
    prevPageBtn.addEventListener('click', () => loadPage(currentPageIndex - 1));
    nextPageBtn.addEventListener('click', () => loadPage(currentPageIndex + 1));

    async function loadPage(index) {
        if (index < 0 || index >= totalPages) return;
        showLoader(`Loading page ${index + 1}...`);

        try {
            const res = await fetch(`/api/page/${fileId}/${index}`);
            const data = await res.json();

            if (res.ok) {
                currentPageIndex = index;
                pdfRealWidth = data.pdf_width;
                pdfRealHeight = data.pdf_height;
                pdfImage.src = data.image;
                pdfImage.onload = () => {
                    updatePaginationUI();
                    renderBoxesForCurrentPage();
                    hideLoader();
                }
            } else {
                alert("Failed to load page: " + data.error);
                hideLoader();
            }
        } catch (e) {
            alert("Failed to load page: " + e.message);
            hideLoader();
        }
    }

    function updatePaginationUI() {
        pageIndicator.innerText = `Page ${currentPageIndex + 1} of ${totalPages}`;
        prevPageBtn.disabled = currentPageIndex === 0;
        nextPageBtn.disabled = currentPageIndex === totalPages - 1;
    }

    // --- 3. ZOOM CONTROLS ---
    zoomInBtn.addEventListener('click', () => setZoom(zoomLevel + 0.25));
    zoomOutBtn.addEventListener('click', () => setZoom(zoomLevel - 0.25));
    zoomResetBtn.addEventListener('click', () => setZoom(1.0));

    function setZoom(level) {
        zoomLevel = Math.max(0.5, Math.min(level, 3.0)); // restrict between 50% and 300%
        zoomWrapper.style.transform = `scale(${zoomLevel})`;
        updateZoomDisplay();
    }

    function updateZoomDisplay() {
        zoomLevelTxt.innerText = `${Math.round(zoomLevel * 100)}%`;
    }

    // --- 4. MULTIPAGE DUPLICATION ---
    duplicateToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            exclusionsContainer.classList.remove('hidden');
        } else {
            exclusionsContainer.classList.add('hidden');
        }
        updateSelectionCount();
    });

    function buildExclusionList() {
        pageListContent.innerHTML = '';
        for (let i = 0; i < totalPages; i++) {
            const div = document.createElement('div');
            div.className = 'page-list-item';
            div.innerHTML = `
                <input type="checkbox" id="page-chk-${i}" value="${i}" checked>
                <label for="page-chk-${i}">Page ${i + 1}</label>
            `;
            pageListContent.appendChild(div);
        }

        // Add event listeners to checkboxes specifically to update count on change
        const checkboxes = pageListContent.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.addEventListener('change', updateSelectionCount);
        });
    }

    // --- PAGE SELECTION MODIFIERS ---
    btnSelectAll.addEventListener('click', () => {
        const checkboxes = pageListContent.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = true);
        updateSelectionCount();
    });

    btnSelectNone.addEventListener('click', () => {
        const checkboxes = pageListContent.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = false);
        updateSelectionCount();
    });

    btnSelectOdd.addEventListener('click', () => {
        const checkboxes = pageListContent.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            const pageNum = parseInt(cb.value) + 1; // 1-indexed for logical odd/even
            cb.checked = (pageNum % 2 !== 0);
        });
        updateSelectionCount();
    });

    btnSelectEven.addEventListener('click', () => {
        const checkboxes = pageListContent.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            const pageNum = parseInt(cb.value) + 1;
            cb.checked = (pageNum % 2 === 0);
        });
        updateSelectionCount();
    });

    // --- AI SMART DUPLICATE ---
    btnAiSmartMatch.addEventListener('click', async () => {
        if (!fileId) return;

        const sourceRegions = selectionsByPage[currentPageIndex];
        if (!sourceRegions || sourceRegions.length === 0) {
            alert("No source regions found on the CURRENT page. Please draw the region(s) you want the AI to match first.");
            return;
        }

        let targetPages = [];
        const checkboxes = document.querySelectorAll('.page-list-item input[type="checkbox"]:checked');
        checkboxes.forEach(cb => {
            let pIdx = parseInt(cb.value);
            if (pIdx !== currentPageIndex) {
                targetPages.push(pIdx);
            }
        });

        if (targetPages.length === 0) {
            alert("Please select at least one OTHER page in the sidebar for the AI to analyze.");
            return;
        }

        showLoader(`AI analyzing layout on ${targetPages.length} target page(s)...`);

        const payload = {
            file_id: fileId,
            source_page_index: currentPageIndex,
            target_pages: targetPages,
            source_regions: sourceRegions.map(r => ({
                id: r.id,
                x0: r.pdfX0, y0: r.pdfY0, x1: r.pdfX1, y1: r.pdfY1
            }))
        };

        try {
            const res = await fetch('/api/smart_duplicate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (res.ok) {
                // Apply the newly generated bounds to the target pages
                const rect = imageWrapper.getBoundingClientRect();
                const nativeWidth = rect.width / zoomLevel;
                const nativeHeight = rect.height / zoomLevel;

                // Keep the scale factors ready to map back from PDF logic to CSS pixel logic
                const scaleX = nativeWidth / pdfRealWidth;
                const scaleY = nativeHeight / pdfRealHeight;

                data.results.forEach(targetResult => {
                    const pIdx = targetResult.page_index;

                    // We will completely overwrite this page's selection with the AI result
                    selectionsByPage[pIdx] = [];

                    targetResult.regions.forEach(aiBox => {
                        boxCounter++;
                        // Map the PDF coords back to UI bounds
                        const uiX0 = aiBox.x0 * scaleX;
                        const uiY0 = aiBox.y0 * scaleY;
                        const uiX1 = aiBox.x1 * scaleX;
                        const uiY1 = aiBox.y1 * scaleY;

                        selectionsByPage[pIdx].push({
                            id: `Smart Region ${boxCounter}`,
                            x0: uiX0,
                            y0: uiY0,
                            w: uiX1 - uiX0,
                            h: uiY1 - uiY0,
                            pdfX0: aiBox.x0,
                            pdfY0: aiBox.y0,
                            pdfX1: aiBox.x1,
                            pdfY1: aiBox.y1
                        });
                    });
                });

                alert(`AI Smart Match complete! The regions on the selected pages have been resized to wrap the logical content. Please review them.`);
                updateSelectionCount();
            } else {
                alert(`AI Smart Match failed: ${data.error}`);
            }
        } catch (e) {
            alert(`AI Request error: ${e.message}`);
        }
        hideLoader();
    });

    // --- 5. DRAWING LOGIC (MULTIPLE BOXES) ---
    imageWrapper.addEventListener('mousedown', (e) => {
        // Do not interupt if clicking on an existing box delete/resize handles
        if (isDraggingBox || isResizingBox) return;

        // Only start drawing a NEW box if clicking directly on the wrapper, the image, or the current drawing box
        // Clicking on an EXISITING .selection-box should NOT start drawing a new box
        if (e.target !== imageWrapper &&
            e.target !== pdfImage &&
            e.target !== drawingBox) {
            return;
        }

        isDrawing = true;
        const rect = imageWrapper.getBoundingClientRect();

        // Adjust for zoom scale to get raw CSS pixels relative to imageWrapper
        startX = (e.clientX - rect.left) / zoomLevel;
        startY = (e.clientY - rect.top) / zoomLevel;

        drawingBox.style.left = `${startX}px`;
        drawingBox.style.top = `${startY}px`;
        drawingBox.style.width = `0px`;
        drawingBox.style.height = `0px`;
        drawingBox.classList.remove('hidden');
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDrawing && !isDraggingBox && !isResizingBox) return;

        const rect = imageWrapper.getBoundingClientRect();
        // The rect width and bounds are currently scaled, so we un-scale to get native Image width limits
        const nativeWidth = rect.width / zoomLevel;
        const nativeHeight = rect.height / zoomLevel;

        let currentX = (e.clientX - rect.left) / zoomLevel;
        let currentY = (e.clientY - rect.top) / zoomLevel;

        currentX = Math.max(0, Math.min(currentX, nativeWidth));
        currentY = Math.max(0, Math.min(currentY, nativeHeight));

        if (isDrawing) {
            const width = Math.abs(currentX - startX);
            const height = Math.abs(currentY - startY);
            const left = Math.min(startX, currentX);
            const top = Math.min(startY, currentY);

            drawingBox.style.width = `${width}px`;
            drawingBox.style.height = `${height}px`;
            drawingBox.style.left = `${left}px`;
            drawingBox.style.top = `${top}px`;
        } else if (isDraggingBox && activeBoxIdx !== null) {
            const dx = currentX - dragStartX;
            const dy = currentY - dragStartY;
            let boxes = selectionsByPage[currentPageIndex];

            // Constrain to bounds
            let newL = boxStartLeft + dx;
            let newT = boxStartTop + dy;
            newL = Math.max(0, Math.min(newL, nativeWidth - boxes[activeBoxIdx].w));
            newT = Math.max(0, Math.min(newT, nativeHeight - boxes[activeBoxIdx].h));

            boxes[activeBoxIdx].x0 = newL;
            boxes[activeBoxIdx].y0 = newT;
            renderBoxesForCurrentPage();
        } else if (isResizingBox && activeBoxIdx !== null) {
            const dx = currentX - dragStartX;
            const dy = currentY - dragStartY;
            let boxes = selectionsByPage[currentPageIndex];

            let newW = boxStartWidth + dx;
            let newH = boxStartHeight + dy;

            // Constrain
            newW = Math.max(10, Math.min(newW, nativeWidth - boxes[activeBoxIdx].x0));
            newH = Math.max(10, Math.min(newH, nativeHeight - boxes[activeBoxIdx].y0));

            boxes[activeBoxIdx].w = newW;
            boxes[activeBoxIdx].h = newH;
            renderBoxesForCurrentPage();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDraggingBox || isResizingBox) {
            if (activeBoxIdx !== null) {
                // Update PDF coordinates accurately for the specific resized box
                let box = selectionsByPage[currentPageIndex][activeBoxIdx];
                const rect = imageWrapper.getBoundingClientRect();
                const nativeWidth = rect.width / zoomLevel;
                const nativeHeight = rect.height / zoomLevel;

                const mapped = mapCoordinatesToPdf(box.x0, box.y0, box.w, box.h, nativeWidth, nativeHeight);
                box.pdfX0 = mapped.x0;
                box.pdfY0 = mapped.y0;
                box.pdfX1 = mapped.x0 + mapped.w;
                box.pdfY1 = mapped.y0 + mapped.h;
            }
            isDraggingBox = false;
            isResizingBox = false;
            activeBoxIdx = null;
            return;
        }

        if (!isDrawing) return;
        isDrawing = false;

        drawingBox.classList.add('hidden');

        const boxWidth = parseFloat(drawingBox.style.width);
        const boxHeight = parseFloat(drawingBox.style.height);
        const boxLeft = parseFloat(drawingBox.style.left);
        const boxTop = parseFloat(drawingBox.style.top);

        if (boxWidth > 10 && boxHeight > 10) {
            boxCounter++;
            const rect = imageWrapper.getBoundingClientRect();
            const nativeWidth = rect.width / zoomLevel;
            const nativeHeight = rect.height / zoomLevel;

            // Map to PDF coordinates using unscaled dimensions
            const mapped = mapCoordinatesToPdf(boxLeft, boxTop, boxWidth, boxHeight, nativeWidth, nativeHeight);

            const newBox = {
                id: `Region ${boxCounter}`,
                x0: boxLeft, y0: boxTop, w: boxWidth, h: boxHeight,
                pdfX0: mapped.x0, pdfY0: mapped.y0, pdfX1: mapped.x0 + mapped.w, pdfY1: mapped.y0 + mapped.h
            };

            if (duplicateToggle.checked) {
                // Clone the box locally onto EVERY checked page individually
                const checkboxes = document.querySelectorAll('.page-list-item input[type="checkbox"]:checked');
                checkboxes.forEach(cb => {
                    const pageNum = parseInt(cb.value);
                    if (!selectionsByPage[pageNum]) selectionsByPage[pageNum] = [];
                    // Deep copy object to break reference so they can be independently resized
                    selectionsByPage[pageNum].push({ ...newBox });
                });
            } else {
                if (!selectionsByPage[currentPageIndex]) {
                    selectionsByPage[currentPageIndex] = [];
                }
                selectionsByPage[currentPageIndex].push({ ...newBox });
            }

            renderBoxesForCurrentPage();
            updateSelectionCount();
        }
    });

    // --- 6. RENDERING BOXES ---
    clearBtn.addEventListener('click', () => {
        if (confirm("Clear all boxes on this page?")) {
            selectionsByPage[currentPageIndex] = [];
            renderBoxesForCurrentPage();
            updateSelectionCount();
        }
    });

    function renderBoxesForCurrentPage() {
        // Clear old DOM boxes (except drawing box and image)
        const existingBoxes = imageWrapper.querySelectorAll('.selection-box:not(#drawing-box)');
        existingBoxes.forEach(b => b.remove());

        // Always only pull the explicitly defined boxes for THIS exact page
        const boxes = selectionsByPage[currentPageIndex] || [];

        boxes.forEach((box, idx) => {
            const div = document.createElement('div');
            div.className = 'selection-box';
            div.style.left = `${box.x0}px`;
            div.style.top = `${box.y0}px`;
            div.style.width = `${box.w}px`;
            div.style.height = `${box.h}px`;

            const label = document.createElement('div');
            label.className = 'box-label';
            label.innerText = box.id;
            div.appendChild(label);

            // Delete button
            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'box-delete-btn';
            deleteBtn.innerText = '×';
            deleteBtn.title = 'Remove this region';
            deleteBtn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectionsByPage[currentPageIndex].splice(idx, 1);
                renderBoxesForCurrentPage();
                updateSelectionCount();
            });
            div.appendChild(deleteBtn);

            const handle = document.createElement('div');
            handle.className = 'resize-handle';
            div.appendChild(handle);

            // Move Logic
            div.addEventListener('mousedown', (e) => {
                if (e.target === handle || e.target === deleteBtn) return;
                e.stopPropagation();
                isDraggingBox = true;
                activeBoxIdx = idx;
                const rect = imageWrapper.getBoundingClientRect();
                dragStartX = (e.clientX - rect.left) / zoomLevel;
                dragStartY = (e.clientY - rect.top) / zoomLevel;
                boxStartLeft = box.x0;
                boxStartTop = box.y0;
            });

            // Resize Logic
            handle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                isResizingBox = true;
                activeBoxIdx = idx;
                const rect = imageWrapper.getBoundingClientRect();
                dragStartX = (e.clientX - rect.left) / zoomLevel;
                dragStartY = (e.clientY - rect.top) / zoomLevel;
                boxStartWidth = box.w;
                boxStartHeight = box.h;
            });

            imageWrapper.appendChild(div);
        });
    }

    function updateSelectionCount() {
        let boxesCount = 0;
        if (duplicateToggle.checked) {
            Object.values(selectionsByPage).forEach(pr => boxesCount += pr.length);
            selectionCountTxt.innerText = `${boxesCount} box(es) duplicated across selected pages`;
        } else {
            const boxes = selectionsByPage[currentPageIndex] || [];
            boxesCount = boxes.length;
            selectionCountTxt.innerText = `${boxesCount} box(es) on Page ${currentPageIndex + 1}`;
        }
        extractBtn.disabled = boxesCount === 0;
    }

    // --- 7. EXTRACTION API CALL ---
    extractBtn.addEventListener('click', async () => {
        if (!fileId) return;

        // Gather all regions we want to extract
        // Case 1: Duplicating first non-empty page's regions across all selected pages
        // Case 2: Just using exact regions drawn on their specific pages

        let targetPages = [];
        let reqPages = [];
        let finalRegionsCount = 0;

        if (duplicateToggle.checked) {
            // Get checked pages from sidebar
            const checkboxes = document.querySelectorAll('.page-list-item input[type="checkbox"]:checked');
            checkboxes.forEach(cb => {
                let pIdx = parseInt(cb.value);
                targetPages.push(pIdx);
                // Extract whatever overridden definitions exist for this page
                if (selectionsByPage[pIdx] && selectionsByPage[pIdx].length > 0) {
                    finalRegionsCount += selectionsByPage[pIdx].length;
                    reqPages.push({
                        page_index: pIdx,
                        regions: selectionsByPage[pIdx].map(r => ({
                            id: r.id,
                            x0: r.pdfX0, y0: r.pdfY0, x1: r.pdfX1, y1: r.pdfY1
                        }))
                    });
                }
            });
        } else {
            // Only extract exactly what is drawn on the current page
            targetPages = [currentPageIndex];
            if (selectionsByPage[currentPageIndex] && selectionsByPage[currentPageIndex].length > 0) {
                finalRegionsCount += selectionsByPage[currentPageIndex].length;
                reqPages.push({
                    page_index: currentPageIndex,
                    regions: selectionsByPage[currentPageIndex].map(r => ({
                        id: r.id,
                        x0: r.pdfX0, y0: r.pdfY0, x1: r.pdfX1, y1: r.pdfY1
                    }))
                });
            }
        }

        if (reqPages.length === 0) {
            alert("No regions drawn to extract.");
            return;
        }

        // Initialize progress bar
        showLoader(`Extracting ${finalRegionsCount} region(s)...`);
        startProgressPolling();

        // Format for backend ExtractRequest model
        const payload = {
            file_id: fileId,
            pages: reqPages
        };

        try {
            const res = await fetch('/api/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            stopProgressPolling();

            if (res.ok) {
                lastExtractionResults = data.results;
                renderResults(data.results);
                resultsPanel.classList.add('open');
                if (resultsPanel.style.height === '' || resultsPanel.style.height === '0px') {
                    resultsPanel.style.height = '45%'; // initialize
                }
            } else {
                alert(`Extraction failed: ${data.error}`);
            }
        } catch (e) {
            stopProgressPolling();
            alert(`Extraction error: ${e.message}`);
        }
        hideLoader();
    });

    // --- 8. RESULTS DISPLAY ---
    function renderResults(pagesData) {
        const textContainer = document.getElementById('result-text');
        const tablesContainer = document.getElementById('result-tables');
        const jsonContainer = document.getElementById('result-json');

        textContainer.innerHTML = '';
        tablesContainer.innerHTML = '';

        let allJsonItems = [];
        let foundAnyTables = false;

        pagesData.forEach(page => {
            // Create Page Blocks for Text
            const textPageBlock = document.createElement('div');
            textPageBlock.className = 'page-result-block';
            textPageBlock.innerHTML = `<h3>Page ${page.page_index + 1}</h3>`;

            // Create Page Blocks for Tables
            const tablePageBlock = document.createElement('div');
            tablePageBlock.className = 'page-result-block';
            tablePageBlock.innerHTML = `<h3>Page ${page.page_index + 1}</h3>`;

            // Create Page Blocks for AI Tables
            const aiTablePageBlock = document.createElement('div');
            aiTablePageBlock.className = 'page-result-block';
            aiTablePageBlock.innerHTML = `<h3>Page ${page.page_index + 1} <span style="font-size: 0.8rem; color: #fbbf24; background: rgba(251, 191, 36, 0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid #fbbf24;">AI Powered</span></h3>`;

            let pageHasTables = false;
            let pageHasAITables = false;

            page.regions.forEach(region => {
                // Text
                const textDiv = document.createElement('div');
                textDiv.className = 'region-result';
                textDiv.innerHTML = `<h4>${region.region_id}</h4><pre>${region.text || "No text found"}</pre>`;
                textPageBlock.appendChild(textDiv);

                // Tables
                if (region.tables && region.tables.length > 0) {
                    foundAnyTables = true;
                    pageHasTables = true;

                    const tRegDiv = document.createElement('div');
                    tRegDiv.className = 'region-result';
                    tRegDiv.innerHTML = `<h4>${region.region_id}</h4>`;

                    region.tables.forEach(tableData => {
                        const tableEl = document.createElement('table');
                        tableData.forEach((row, rIdx) => {
                            const tr = document.createElement('tr');
                            row.forEach(cell => {
                                const cellEl = document.createElement(rIdx === 0 ? 'th' : 'td');
                                cellEl.innerText = cell !== null ? cell : "";
                                tr.appendChild(cellEl);
                            });
                            tableEl.appendChild(tr);
                        });
                        tRegDiv.appendChild(tableEl);
                    });
                    tablePageBlock.appendChild(tRegDiv);
                }

                // AI Tables (Now Arrays of Objects)
                if (region.ai_table && region.ai_table.length > 0) {
                    foundAnyTables = true;
                    pageHasAITables = true;

                    // Collect for JSON tab
                    allJsonItems.push({
                        page: page.page_index + 1,
                        region: region.region_id,
                        data: region.ai_table
                    });

                    const tRegDiv = document.createElement('div');
                    tRegDiv.className = 'region-result';
                    tRegDiv.innerHTML = `<h4>${region.region_id} <span style="font-size: 0.7rem; color: #fbbf24;">(AI Structured JSON)</span></h4>`;

                    const tableEl = document.createElement('table');

                    // Extract headers from the first object keys
                    const headers = Object.keys(region.ai_table[0]);

                    // Build Header Row
                    const headTr = document.createElement('tr');
                    headers.forEach(h => {
                        const th = document.createElement('th');
                        th.innerText = h;
                        headTr.appendChild(th);
                    });
                    tableEl.appendChild(headTr);

                    // Build Data Rows
                    region.ai_table.forEach((rowObj) => {
                        const tr = document.createElement('tr');
                        headers.forEach(h => {
                            const td = document.createElement('td');
                            td.innerText = rowObj[h] !== undefined && rowObj[h] !== null ? rowObj[h] : "";
                            tr.appendChild(td);
                        });
                        tableEl.appendChild(tr);
                    });

                    tRegDiv.appendChild(tableEl);
                    aiTablePageBlock.appendChild(tRegDiv);
                }
            });

            textContainer.appendChild(textPageBlock);
            if (pageHasAITables) {
                tablesContainer.appendChild(aiTablePageBlock);
            }
            if (pageHasTables) {
                tablesContainer.appendChild(tablePageBlock);
            }
        });

        // Populate JSON Tab
        if (allJsonItems.length > 0) {
            jsonContainer.innerText = JSON.stringify(allJsonItems, null, 2);
        } else {
            jsonContainer.innerText = "No structured JSON data available.";
        }

        if (foundAnyTables) {
            exportCsvBtn.classList.remove('hidden');
            document.querySelector('.tab[data-tab="tab-structured"]').click();
        } else {
            exportCsvBtn.classList.add('hidden');
            tablesContainer.innerHTML = 'No structured tables found strictly within these boundaries.';
            document.querySelector('.tab[data-tab="tab-raw"]').click();
        }
    }

    // Tabs logic
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabPanes.forEach(tp => tp.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    // Toggle results panel instead of purely closing
    function toggleResultsPanel(forceState = null) {
        const isOpen = resultsPanel.classList.contains('open');
        const shouldOpen = forceState !== null ? forceState : !isOpen;

        if (!shouldOpen) {
            resultsPanel.classList.remove('open');
            resultsPanel.style.height = '0px';
            floatingResultsBtn.classList.remove('hidden');
        } else {
            resultsPanel.classList.add('open');
            resultsPanel.style.height = '45%';
            floatingResultsBtn.classList.add('hidden');
        }
    }

    closeResultsBtn.addEventListener('click', () => toggleResultsPanel(false));
    floatingResultsBtn.addEventListener('click', () => toggleResultsPanel(true));

    // Initially show the button if there are results
    function tryShowFloatingBtn() {
        if (lastExtractionResults && lastExtractionResults.length > 0) {
            if (!resultsPanel.classList.contains('open')) {
                floatingResultsBtn.classList.remove('hidden');
            }
        }
    }

    // call tryShowFloatingBtn on initialize/extraction
    const originalRenderResults = renderResults;
    renderResults = function (pagesData) {
        originalRenderResults(pagesData);
        floatingResultsBtn.classList.add('hidden'); // hidden while open
    };

    // --- 9. EXPORT CSV ---
    exportCsvBtn.addEventListener('click', () => {
        if (!lastExtractionResults) return;

        let csvContent = "";

        lastExtractionResults.forEach(page => {
            page.regions.forEach(region => {

                if (region.ai_table && region.ai_table.length > 0) {
                    // Export Array of Objects
                    csvContent += `Page ${page.page_index + 1} - ${region.region_id} (AI)\n`;
                    const headers = Object.keys(region.ai_table[0]);
                    csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(",") + "\n";

                    region.ai_table.forEach(rowObj => {
                        let rowStr = headers.map(h => {
                            let val = rowObj[h] === null || rowObj[h] === undefined ? "" : String(rowObj[h]);
                            return `"${val.replace(/"/g, '""')}"`;
                        }).join(",");
                        csvContent += rowStr + "\n";
                    });
                    csvContent += "\n";

                } else if (region.tables && region.tables.length > 0) {
                    // Export Array of Arrays (Native)
                    csvContent += `Page ${page.page_index + 1} - ${region.region_id}\n`;
                    region.tables.forEach(table => {
                        table.forEach(row => {
                            let rowStr = row.map(cell => {
                                let c = cell === null ? "" : String(cell);
                                return `"${c.replace(/"/g, '""')}"`;
                            }).join(",");
                            csvContent += rowStr + "\n";
                        });
                        csvContent += "\n";
                    });
                }
            });
        });

        if (!csvContent) {
            alert("No tables available to export.");
            return;
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "extracted_tables.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // --- UTILS ---
    let progressInterval = null;

    function startProgressPolling() {
        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(async () => {
            try {
                const res = await fetch('/api/progress');
                if (res.ok) {
                    const prog = await res.json();
                    const stage = prog.stage || '';
                    const total = prog.total || 0;
                    const done = prog.completed || 0;
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    if (stage === 'Done') {
                        stopProgressPolling();
                    } else {
                        loaderText.innerText = `${stage} (${pct}%)`;
                    }
                }
            } catch (_) { }
        }, 800);
    }

    function stopProgressPolling() {
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
    }

    function mapCoordinatesToPdf(boxX, boxY, boxW, boxH, imgW, imgH) {
        const scaleX = pdfRealWidth / imgW;
        const scaleY = pdfRealHeight / imgH;
        return {
            x0: boxX * scaleX,
            y0: boxY * scaleY,
            w: boxW * scaleX,
            h: boxH * scaleY
        };
    }

    function showLoader(msg) {
        loaderText.innerText = msg;
        loader.classList.add('active');
    }

    function hideLoader() {
        loader.classList.remove('active');
    }
});
