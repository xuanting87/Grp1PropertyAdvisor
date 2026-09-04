/**
 * app.js
 * Singapore Property Price Advisor
 * 
 * Architecture: Vanilla JavaScript (ES6 Modules)
 * - Single-page application logic with 5 key modules:
 *   1. Price Advisor (comparable transactions & statistical range)
 *   2. Location Comparison (2-4 towns side-by-side)
 *   3. Price Trend Timeline (native canvas chart)
 *   4. Documentation Advisor (static reviewed JSON reference)
 *   5. Amenities Overview (OneMap geocoding & Leaflet map)
 * 
 * All functions are documented with explanatory comments for non-technical readers.
 */

/* ==========================================================================
   GLOBAL CONSTANTS & APPLICATION STATE
   ========================================================================== */

/** List of all 26 official Singapore HDB Towns / Planning Areas */
const SINGAPORE_TOWNS = [
  'ANG MO KIO', 'BEDOK', 'BISHAN', 'BUKIT BATOK', 'BUKIT MERAH',
  'BUKIT PANJANG', 'BUKIT TIMAH', 'CENTRAL AREA', 'CHOA CHU KANG',
  'CLEMENTI', 'GEYLANG', 'HOUGANG', 'JURONG EAST', 'JURONG WEST',
  'KALLANG/WHAMPOA', 'MARINE PARADE', 'PASIR RIS', 'PUNGGOL',
  'QUEENSTOWN', 'SEMBAWANG', 'SENGKANG', 'SERANGOON', 'TAMPINES',
  'TOA PAYOH', 'WOODLANDS', 'YISHUN'
];

/** Central application state store */
const AppState = {
  // Current active navigation tab
  activeTab: 'panel-price-advisor',
  
  // Currently selected property location coordinates
  currentLocation: {
    lat: 1.3733,
    lng: 103.8365,
    address: '116 Ang Mo Kio Ave 4',
    town: 'ANG MO KIO'
  },

  // Location Comparison selected towns (2 to 4)
  comparisonTowns: ['ANG MO KIO', 'BISHAN', 'BEDOK'],

  // Price Trend Chart State
  trendData: null,
  trendRangeMonths: 12,
  trendMetric: 'price', // 'price' or 'psf'

  // Documentation Advisor Data
  docChecklistData: null,
  userCompletedSteps: new Set(),

  // Amenities Data & Map Instance
  leafletMap: null,
  mapMarkersLayer: null,
  propertyMarker: null,
  amenitiesItems: [],
  selectedAmenityCategory: 'all'
};

/* ==========================================================================
   UTILITY & FORMATTING FUNCTIONS
   ========================================================================== */

/**
 * Formats a number as Singapore Dollars (e.g. 580000 -> "$580,000").
 * @param {number} num - Numeric currency amount
 * @returns {string} Formatted currency string
 */
function formatCurrency(num) {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return '$' + Math.round(num).toLocaleString('en-SG');
}

/**
 * Formats a number with comma separators (e.g. 1250 -> "1,250").
 * @param {number} num 
 * @returns {string}
 */
function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return Math.round(num).toLocaleString('en-SG');
}

/**
 * Debounce helper function: Delays function execution until after a specified
 * wait time has elapsed since the last time it was invoked. Used on search
 * input fields to avoid hammering government APIs with rapid keystrokes.
 * @param {Function} func - Function to execute
 * @param {number} waitMs - Milliseconds to delay (e.g. 350ms)
 * @returns {Function} Debounced function
 */
function debounce(func, waitMs = 350) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), waitMs);
  };
}

/* ==========================================================================
   1. NAVIGATION & TAB SWITCHING
   ========================================================================== */

/**
 * Initializes tab switching behavior. Binds click events to top navigation
 * buttons and toggles the active section.
 */
function initNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  const sections = document.querySelectorAll('.panel-section');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetPanelId = tab.getAttribute('data-panel');
      if (!targetPanelId) return;

      // Update tab active state
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update panel section visibility
      sections.forEach(sec => {
        if (sec.id === targetPanelId) {
          sec.classList.add('active');
        } else {
          sec.classList.remove('active');
        }
      });

      AppState.activeTab = targetPanelId;

      // If user switched to Amenities tab, trigger map container resize calculation
      if (targetPanelId === 'panel-amenities' && AppState.leafletMap) {
        setTimeout(() => {
          AppState.leafletMap.invalidateSize();
        }, 150);
      }

      // If user switched to Price Trends, redraw canvas chart for container dimensions
      if (targetPanelId === 'panel-trends') {
        setTimeout(() => {
          renderTrendChart();
        }, 150);
      }
    });
  });

  // Top-right Create Account button in header
  const headerBtnCreate = document.getElementById('header-btn-create-account');
  if (headerBtnCreate) {
    headerBtnCreate.addEventListener('click', () => {
      const accountTab = document.getElementById('tab-create-account');
      if (accountTab) {
        accountTab.click();
      }
    });
  }
}

/* ==========================================================================
   2. ONEMAP GEOCODING & AUTOCOMPLETE
   ========================================================================== */

/**
 * Binds geocoding autocomplete to an input element and dropdown container.
 * When a user types an address or postal code, it calls /api/geocode
 * and displays matching Singapore buildings and roads.
 * @param {string} inputId - ID of search input
 * @param {string} dropdownId - ID of dropdown element
 * @param {Function} onSelectCallback - Function called when an address is chosen
 */
function setupAddressAutocomplete(inputId, dropdownId, onSelectCallback) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  const performSearch = debounce(async (query) => {
    if (!query || query.trim().length < 2) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      return;
    }

    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const data = await response.json();

      if (data.success && data.results && data.results.length > 0) {
        dropdown.innerHTML = '';
        data.results.forEach(item => {
          const opt = document.createElement('div');
          opt.className = 'autocomplete-item';
          opt.setAttribute('role', 'option');

          const mainTitle = item.building || item.roadName || item.searchValue;
          const subTitle = item.postal ? `${item.address} (Postal ${item.postal})` : item.address;

          opt.innerHTML = `
            <div class="autocomplete-title">${escapeHtml(mainTitle)}</div>
            <div class="autocomplete-sub">${escapeHtml(subTitle)} • <em>${escapeHtml(item.town)}</em></div>
          `;

          opt.addEventListener('click', () => {
            input.value = item.address;
            dropdown.classList.remove('active');
            dropdown.innerHTML = '';
            if (onSelectCallback) onSelectCallback(item);
          });

          dropdown.appendChild(opt);
        });
        dropdown.classList.add('active');
      } else {
        dropdown.classList.remove('active');
        dropdown.innerHTML = '';
      }
    } catch (err) {
      console.warn('Geocoding autocomplete error:', err);
      dropdown.classList.remove('active');
    }
  }, 300);

  input.addEventListener('input', (e) => {
    performSearch(e.target.value);
  });

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('active');
    }
  });

  // Close dropdown on Escape key
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.classList.remove('active');
    }
  });
}

/**
 * Escapes HTML strings to prevent XSS injection.
 * @param {string} str 
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function (m) {
    return ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m];
  });
}

/* ==========================================================================
   3. PRICE ADVISOR MODULE
   ========================================================================== */

/**
 * Sets up event listeners and query lifecycle for the Price Advisor panel.
 */
function initPriceAdvisor() {
  const form = document.getElementById('price-advisor-form');
  const resetBtn = document.getElementById('btn-reset-price');
  const retryBtn = document.getElementById('btn-retry-price');
  const townSelect = document.getElementById('select-town');
  const propSelect = document.getElementById('select-property-type');

  // Handle autocomplete selection for the address input
  setupAddressAutocomplete('input-address', 'address-dropdown', (selectedPlace) => {
    if (selectedPlace.town) {
      townSelect.value = selectedPlace.town;
    }
    AppState.currentLocation = {
      lat: selectedPlace.latitude,
      lng: selectedPlace.longitude,
      address: selectedPlace.address,
      town: selectedPlace.town
    };
    // Sync address with Amenities panel
    const amenityInput = document.getElementById('amenity-address-input');
    if (amenityInput) amenityInput.value = selectedPlace.address;
  });

  // Form Submission
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    executePriceQuery();
  });

  if (retryBtn) {
    retryBtn.addEventListener('click', executePriceQuery);
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      form.reset();
      document.getElementById('price-empty-state').style.display = 'flex';
      document.getElementById('price-loading-state').style.display = 'none';
      document.getElementById('price-error-state').style.display = 'none';
      document.getElementById('price-insufficient-banner').style.display = 'none';
      document.getElementById('price-results-card').style.display = 'none';
    });
  }

  // Handle Property Type switch (Alert user if Private selected without URA token)
  propSelect.addEventListener('change', () => {
    if (propSelect.value === 'private') {
      alert('Note: Private property transaction lookups connect to the URA API and require an active URA_ACCESS_KEY. Real-time HDB resale transactions from data.gov.sg are available keyless.');
    }
  });
}

/**
 * Executes API call to /api/prices and renders indicative price statistics.
 */
async function executePriceQuery() {
  const town = document.getElementById('select-town').value;
  const flatType = document.getElementById('select-flat-type').value;
  const propertyType = document.getElementById('select-property-type').value;
  const leaseRange = document.getElementById('select-lease-range').value;
  const windowMonths = document.getElementById('select-window').value;

  // DOM Containers
  const emptyState = document.getElementById('price-empty-state');
  const loadingState = document.getElementById('price-loading-state');
  const errorState = document.getElementById('price-error-state');
  const insufficientBanner = document.getElementById('price-insufficient-banner');
  const resultsCard = document.getElementById('price-results-card');

  // Set loading state
  emptyState.style.display = 'none';
  loadingState.style.display = 'flex';
  errorState.style.display = 'none';
  insufficientBanner.style.display = 'none';
  resultsCard.style.display = 'none';

  // Construct query parameters
  let url = `/api/prices?town=${encodeURIComponent(town)}&flatType=${encodeURIComponent(flatType)}&propertyType=${encodeURIComponent(propertyType)}&windowMonths=${windowMonths}`;

  if (leaseRange !== 'all') {
    const [lMin, lMax] = leaseRange.split('-').map(Number);
    if (!isNaN(lMin)) url += `&leaseMin=${lMin}`;
    if (!isNaN(lMax)) url += `&leaseMax=${lMax}`;
  }

  try {
    const response = await fetch(url);
    const data = await response.json();

    loadingState.style.display = 'none';

    if (!data.success) {
      errorState.style.display = 'flex';
      document.getElementById('price-error-title').textContent = data.dataAvailable === false ? 'Data Not Available' : 'Retrieval Failed';
      document.getElementById('price-error-desc').textContent = data.error || 'Failed to retrieve records.';
      return;
    }

    // Check guardrail: Insufficient sample size (< 5 transactions)
    if (!data.hasSufficientData) {
      insufficientBanner.style.display = 'flex';
      document.getElementById('price-insufficient-text').textContent = data.warningMessage;
      
      // If there are a few comparables, still display them below the warning
      if (data.comparables && data.comparables.length > 0) {
        renderComparablesTable(data.comparables);
        resultsCard.style.display = 'block';
        document.getElementById('price-hero-box').style.display = 'none';
        document.getElementById('price-gauge-container').style.display = 'none';
      }
      return;
    }

    // Display rich statistical results
    resultsCard.style.display = 'block';
    document.getElementById('price-hero-box').style.display = 'block';
    document.getElementById('price-gauge-container').style.display = 'flex';

    // Format 25th - 75th percentile range
    const lowFmt = formatCurrency(data.priceRange.low);
    const highFmt = formatCurrency(data.priceRange.high);
    document.getElementById('price-range-display').textContent = `${lowFmt} – ${highFmt}`;
    document.getElementById('price-hero-sub').textContent = `Based on ${data.sampleSize} verified comparable transactions in ${data.town} (${data.flatType}, past ${data.windowMonths} months)`;

    // Metrics boxes
    document.getElementById('price-median-val').textContent = formatCurrency(data.priceRange.median);
    document.getElementById('price-psf-val').textContent = `$${formatNumber(data.psfMetrics.medianPsf)}/sqft`;
    document.getElementById('price-area-val').textContent = `${data.areaMetrics.medianAreaSqm} sqm (${formatNumber(data.areaMetrics.medianAreaSqft)} sqft)`;
    document.getElementById('price-sample-val').textContent = `${data.sampleSize} transactions`;

    // Statistical Gauge Labels
    document.getElementById('gauge-min-label').textContent = `Min: ${formatCurrency(data.priceRange.min)}`;
    document.getElementById('gauge-p25-label').textContent = `25%: ${lowFmt}`;
    document.getElementById('gauge-median-label').textContent = `Median: ${formatCurrency(data.priceRange.median)}`;
    document.getElementById('gauge-p75-label').textContent = `75%: ${highFmt}`;
    document.getElementById('gauge-max-label').textContent = `Max: ${formatCurrency(data.priceRange.max)}`;

    // Calculate percentage fill position for the 25% - 75% IQR span
    const spanTotal = data.priceRange.max - data.priceRange.min || 1;
    const p25Offset = Math.max(0, Math.min(100, ((data.priceRange.low - data.priceRange.min) / spanTotal) * 100));
    const p75Offset = Math.max(0, Math.min(100, ((data.priceRange.high - data.priceRange.min) / spanTotal) * 100));
    const fillBar = document.getElementById('gauge-fill-bar');
    fillBar.style.left = `${p25Offset}%`;
    fillBar.style.width = `${Math.max(4, p75Offset - p25Offset)}%`;

    // Render detailed comparables table
    renderComparablesTable(data.comparables);

    // Sync selected town with Price Trend and Location Comparison
    syncTownWithOtherPanels(data.town, data.flatType);

  } catch (err) {
    console.error('Price advisor request error:', err);
    loadingState.style.display = 'none';
    errorState.style.display = 'flex';
    document.getElementById('price-error-desc').textContent = err.message || 'Network request failed.';
  }
}

/**
 * Populates the comparables table with individual transaction rows.
 * @param {Array} comparables - Array of transaction objects
 */
function renderComparablesTable(comparables) {
  const tbody = document.getElementById('comparables-tbody');
  const badge = document.getElementById('comparables-count-badge');
  if (!tbody) return;

  tbody.innerHTML = '';
  badge.textContent = `${comparables.length} verified records`;

  comparables.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>Blk ${escapeHtml(c.block)}</strong> ${escapeHtml(c.streetName)}</td>
      <td><span class="badge-tag">${escapeHtml(c.storeyRange)}</span></td>
      <td>${c.floorAreaSqm} sqm (${c.floorAreaSqft} sqft)</td>
      <td>${escapeHtml(c.remainingLease || '-')}</td>
      <td>${escapeHtml(c.month)}</td>
      <td><strong>${formatCurrency(c.resalePrice)}</strong></td>
      <td>$${formatNumber(c.psf)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Synchronizes selected town & flat type across other panels for a seamless flow.
 * @param {string} town 
 * @param {string} flatType 
 */
function syncTownWithOtherPanels(town, flatType) {
  const trendTown = document.getElementById('trend-town');
  const trendFlat = document.getElementById('trend-flat-type');
  if (trendTown) trendTown.value = town;
  if (trendFlat) trendFlat.value = flatType;
}

/* ==========================================================================
   4. LOCATION COMPARISON MODULE
   ========================================================================== */

/**
 * Initializes the 2-4 location comparison picker and execution handlers.
 */
function initLocationComparison() {
  const chipsContainer = document.getElementById('town-chips-container');
  const compareBtn = document.getElementById('btn-run-comparison');
  if (!chipsContainer || !compareBtn) return;

  // Render town chips
  chipsContainer.innerHTML = '';
  SINGAPORE_TOWNS.forEach(town => {
    const chip = document.createElement('div');
    chip.className = 'town-chip' + (AppState.comparisonTowns.includes(town) ? ' active' : '');
    chip.setAttribute('role', 'checkbox');
    chip.setAttribute('aria-checked', AppState.comparisonTowns.includes(town) ? 'true' : 'false');
    chip.textContent = town;

    chip.addEventListener('click', () => {
      const idx = AppState.comparisonTowns.indexOf(town);
      if (idx > -1) {
        // Deselecting: require at least 2 towns
        if (AppState.comparisonTowns.length <= 2) {
          alert('You must keep at least 2 towns selected for side-by-side comparison.');
          return;
        }
        AppState.comparisonTowns.splice(idx, 1);
        chip.classList.remove('active');
        chip.setAttribute('aria-checked', 'false');
      } else {
        // Selecting: maximum 4 towns
        if (AppState.comparisonTowns.length >= 4) {
          alert('You can compare a maximum of 4 towns side-by-side.');
          return;
        }
        AppState.comparisonTowns.push(town);
        chip.classList.add('active');
        chip.setAttribute('aria-checked', 'true');
      }
    });

    chipsContainer.appendChild(chip);
  });

  compareBtn.addEventListener('click', executeLocationComparison);
}

/**
 * Executes API call to compare selected towns and renders comparison cards.
 */
async function executeLocationComparison() {
  const towns = AppState.comparisonTowns;
  const flatType = document.getElementById('comparison-flat-type').value;
  const windowMonths = document.getElementById('comparison-window').value;

  const emptyState = document.getElementById('comparison-empty-state');
  const loadingState = document.getElementById('comparison-loading-state');
  const errorState = document.getElementById('comparison-error-state');
  const cardsGrid = document.getElementById('comparison-cards-grid');
  const summaryCard = document.getElementById('comparison-summary-card');

  emptyState.style.display = 'none';
  loadingState.style.display = 'flex';
  errorState.style.display = 'none';
  cardsGrid.style.display = 'none';
  summaryCard.style.display = 'none';

  const url = `/api/trends?towns=${encodeURIComponent(towns.join(','))}&flatType=${encodeURIComponent(flatType)}&windowMonths=${windowMonths}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    loadingState.style.display = 'none';

    if (!data.success || !data.results) {
      errorState.style.display = 'flex';
      document.getElementById('comparison-error-desc').textContent = data.error || 'Failed to compare towns.';
      return;
    }

    cardsGrid.style.display = 'grid';
    cardsGrid.innerHTML = '';

    // Find min and max median prices to highlight differences
    const validTowns = data.results.filter(r => r.hasSufficientData);
    let minPriceTown = null;
    let maxPriceTown = null;

    if (validTowns.length > 0) {
      minPriceTown = validTowns.reduce((prev, curr) => curr.medianPrice < prev.medianPrice ? curr : prev);
      maxPriceTown = validTowns.reduce((prev, curr) => curr.medianPrice > prev.medianPrice ? curr : prev);
    }

    data.results.forEach(townData => {
      const card = document.createElement('div');
      card.className = 'comparison-card' + (maxPriceTown && townData.town === maxPriceTown.town ? ' highlight' : '');

      if (!townData.hasSufficientData) {
        card.innerHTML = `
          <div class="comparison-town-title">${escapeHtml(townData.town)}</div>
          <div class="alert-warning-banner" style="margin: 0.5rem 0;">
            <p>${escapeHtml(townData.warningMessage || 'Under 5 transactions found.')}</p>
          </div>
        `;
      } else {
        card.innerHTML = `
          <div class="comparison-town-title">${escapeHtml(townData.town)}</div>
          <div style="font-size: 0.8125rem; color: var(--md-sys-color-on-surface-variant); margin-top: -0.5rem;">
            ${escapeHtml(townData.flatType)} (${townData.sampleSize} sales)
          </div>

          <div style="margin: 0.5rem 0;">
            <div style="font-size: 0.75rem; color: var(--md-sys-color-on-surface-variant);">Median Resale Price</div>
            <div style="font-size: 1.5rem; font-weight: 800; color: var(--md-sys-color-primary);">
              ${formatCurrency(townData.medianPrice)}
            </div>
          </div>

          <div class="comparison-metric-item">
            <span>Price Per Sqft:</span>
            <span class="comparison-metric-val">$${formatNumber(townData.medianPsf)} / sqft</span>
          </div>

          <div class="comparison-metric-item">
            <span>25% - 75% IQR Range:</span>
            <span class="comparison-metric-val">${formatCurrency(townData.p25Price)} – ${formatCurrency(townData.p75Price)}</span>
          </div>

          <div class="comparison-metric-item">
            <span>Lowest Transacted:</span>
            <span class="comparison-metric-val">${formatCurrency(townData.minPrice)}</span>
          </div>

          <div class="comparison-metric-item">
            <span>Highest Transacted:</span>
            <span class="comparison-metric-val">${formatCurrency(townData.maxPrice)}</span>
          </div>

          <div class="comparison-metric-item">
            <span>Transaction Volume:</span>
            <span class="comparison-metric-val">${formatNumber(townData.sampleSize)} units</span>
          </div>
        `;
      }

      cardsGrid.appendChild(card);
    });

    // Render comparative takeaways
    if (validTowns.length >= 2) {
      summaryCard.style.display = 'block';
      const insightsBox = document.getElementById('comparison-insights-content');
      const priceDiff = maxPriceTown.medianPrice - minPriceTown.medianPrice;
      const pctDiff = Math.round((priceDiff / minPriceTown.medianPrice) * 100);

      // Volume leader
      const volumeLeader = validTowns.reduce((prev, curr) => curr.sampleSize > prev.sampleSize ? curr : prev);

      insightsBox.innerHTML = `
        <ul style="list-style-type: disc; margin-left: 1.25rem; font-size: 0.875rem; display: flex; flex-direction: column; gap: 0.4rem;">
          <li><strong>Price Spread:</strong> <strong>${maxPriceTown.town}</strong> commands the highest median price at <strong>${formatCurrency(maxPriceTown.medianPrice)}</strong>, which is <strong>${formatCurrency(priceDiff)} (+${pctDiff}%)</strong> higher than <strong>${minPriceTown.town}</strong> (${formatCurrency(minPriceTown.medianPrice)}).</li>
          <li><strong>PSF Comparison:</strong> Median price per square foot ranges from <strong>$${formatNumber(minPriceTown.medianPsf)}/sqft</strong> in ${minPriceTown.town} to <strong>$${formatNumber(maxPriceTown.medianPsf)}/sqft</strong> in ${maxPriceTown.town}.</li>
          <li><strong>Market Liquidity:</strong> <strong>${volumeLeader.town}</strong> recorded the highest transaction velocity with <strong>${formatNumber(volumeLeader.sampleSize)} resale transactions</strong> during this period.</li>
        </ul>
      `;
    }

  } catch (err) {
    console.error('Comparison error:', err);
    loadingState.style.display = 'none';
    errorState.style.display = 'flex';
    document.getElementById('comparison-error-desc').textContent = err.message || 'Comparison failed.';
  }
}

/* ==========================================================================
   5. PRICE TREND TIMELINE (LIGHTWEIGHT NATIVE CANVAS CHART)
   ========================================================================== */

/**
 * Chart implementation choice: Native HTML5 <canvas> 2D rendering.
 * Justification: Zero external dependencies (<5KB code), lightning-fast load
 * times on mobile, crisp retina/devicePixelRatio rendering, smooth cubic
 * bezier spline curves, custom interactive hover tooltips, and complete
 * WCAG 2.1 AA compliant fallback table for assistive screen readers.
 */

function initPriceTrends() {
  const townSelect = document.getElementById('trend-town');
  const flatSelect = document.getElementById('trend-flat-type');
  const metricPriceBtn = document.getElementById('btn-metric-price');
  const metricPsfBtn = document.getElementById('btn-metric-psf');
  const rangeBtns = [
    document.getElementById('btn-range-3m'),
    document.getElementById('btn-range-6m'),
    document.getElementById('btn-range-1y')
  ];

  // Fetch new data when town or flat type changes
  if (townSelect) townSelect.addEventListener('change', fetchTrendData);
  if (flatSelect) flatSelect.addEventListener('change', fetchTrendData);

  // Metric toggles (re-render existing chart data without extra network requests)
  if (metricPriceBtn && metricPsfBtn) {
    metricPriceBtn.addEventListener('click', () => {
      metricPriceBtn.classList.add('active');
      metricPsfBtn.classList.remove('active');
      AppState.trendMetric = 'price';
      renderTrendChart();
    });

    metricPsfBtn.addEventListener('click', () => {
      metricPsfBtn.classList.add('active');
      metricPriceBtn.classList.remove('active');
      AppState.trendMetric = 'psf';
      renderTrendChart();
    });
  }

  // Time range toggles (3M, 6M, 1Y) - reuses single chart instance
  rangeBtns.forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      rangeBtns.forEach(b => b && b.classList.remove('active'));
      btn.classList.add('active');
      AppState.trendRangeMonths = parseInt(btn.getAttribute('data-range'), 10) || 12;
      renderTrendChart();
    });
  });

  // Setup interactive crosshair hover on canvas
  setupChartHover();

  // Initial load
  fetchTrendData();
}

/**
 * Fetches historical monthly data from /api/trends for the selected town & flat.
 */
async function fetchTrendData() {
  const town = document.getElementById('trend-town').value;
  const flatType = document.getElementById('trend-flat-type').value;

  const loadingState = document.getElementById('trend-loading-state');
  const errorState = document.getElementById('trend-error-state');
  const canvasWrapper = document.getElementById('canvas-chart-wrapper');
  const statsRow = document.getElementById('trend-stats-row');

  loadingState.style.display = 'flex';
  errorState.style.display = 'none';
  canvasWrapper.style.opacity = '0.3';
  statsRow.style.opacity = '0.3';

  document.getElementById('chart-dynamic-title').textContent = `${flatType} Flat Trend in ${town}`;

  try {
    const res = await fetch(`/api/trends?town=${encodeURIComponent(town)}&flatType=${encodeURIComponent(flatType)}`);
    const data = await res.json();

    loadingState.style.display = 'none';
    canvasWrapper.style.opacity = '1';
    statsRow.style.opacity = '1';

    if (!data.success || !data.timeline) {
      errorState.style.display = 'flex';
      document.getElementById('trend-error-desc').textContent = data.warningMessage || 'No trend data.';
      return;
    }

    AppState.trendData = data.timeline;
    renderTrendChart();

  } catch (err) {
    console.error('Trend fetch error:', err);
    loadingState.style.display = 'none';
    errorState.style.display = 'flex';
    document.getElementById('trend-error-desc').textContent = err.message || 'Failed to load timeline.';
  }
}

/**
 * Renders the responsive Canvas chart using the active range (3M, 6M, 1Y)
 * and active metric (Price or PSF).
 */
function renderTrendChart() {
  if (!AppState.trendData || AppState.trendData.length === 0) return;

  const canvas = document.getElementById('trend-chart-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  // Set high-DPI retina display resolution
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;

  // Filter timeline according to selected range (3, 6, or 12 months)
  const rangeMonths = AppState.trendRangeMonths;
  const activeTimeline = AppState.trendData.slice(-rangeMonths);

  if (activeTimeline.length === 0) return;

  // Update timeframe badge
  const rangeLabel = rangeMonths === 3 ? 'Past 3 Months' : rangeMonths === 6 ? 'Past 6 Months' : 'Past 12 Months';
  document.getElementById('chart-timeframe-tag').textContent = rangeLabel;

  // Determine values to chart based on metric toggle
  const isPsf = AppState.trendMetric === 'psf';
  const values = activeTimeline.map(item => isPsf ? item.medianPsf : item.medianPrice);

  // Compute scale boundaries
  let minVal = Math.min(...values);
  let maxVal = Math.max(...values);
  const paddingBuffer = (maxVal - minVal) * 0.15 || 5000;
  minVal = Math.max(0, minVal - paddingBuffer);
  maxVal = maxVal + paddingBuffer;

  // Chart padding geometry
  const padLeft = 70;
  const padRight = 30;
  const padTop = 30;
  const padBottom = 45;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Clear previous frame
  ctx.clearRect(0, 0, width, height);

  // 1. Draw Horizontal Gridlines & Y-Axis Labels
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#64748b';
  ctx.font = '11px Plus Jakarta Sans, sans-serif';
  ctx.textAlign = 'right';

  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const yVal = minVal + ((maxVal - minVal) / gridSteps) * (gridSteps - i);
    const yPos = padTop + (chartH / gridSteps) * i;

    // Grid line
    ctx.beginPath();
    ctx.moveTo(padLeft, yPos);
    ctx.lineTo(width - padRight, yPos);
    ctx.stroke();

    // Y-Axis label
    const labelText = isPsf ? `$${Math.round(yVal)}` : `$${Math.round(yVal / 1000)}k`;
    ctx.fillText(labelText, padLeft - 10, yPos + 4);
  }

  // Calculate coordinates for each data point
  const points = activeTimeline.map((item, idx) => {
    const x = padLeft + (chartW / Math.max(1, activeTimeline.length - 1)) * idx;
    const y = padTop + chartH - ((values[idx] - minVal) / (maxVal - minVal)) * chartH;
    return { x, y, val: values[idx], month: item.month, volume: item.volume };
  });

  // Store coordinates in AppState for hover detection
  AppState.chartRenderedPoints = points;

  // 2. Draw Gradient Fill Under Curve
  const fillGrad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
  fillGrad.addColorStop(0, 'rgba(37, 99, 235, 0.16)');
  fillGrad.addColorStop(1, 'rgba(37, 99, 235, 0.00)');

  ctx.beginPath();
  ctx.moveTo(points[0].x, padTop + chartH);
  ctx.lineTo(points[0].x, points[0].y);

  // Smooth cubic bezier spline
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cpX = (p0.x + p1.x) / 2;
    ctx.bezierCurveTo(cpX, p0.y, cpX, p1.y, p1.x, p1.y);
  }

  ctx.lineTo(points[points.length - 1].x, padTop + chartH);
  ctx.closePath();
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // 3. Draw Spline Line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cpX = (p0.x + p1.x) / 2;
    ctx.bezierCurveTo(cpX, p0.y, cpX, p1.y, p1.x, p1.y);
  }
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 4. Draw Point Circles & X-Axis Labels
  ctx.textAlign = 'center';
  points.forEach((pt, idx) => {
    // Circle
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.stroke();

    // X-Axis Month label (Show every 1 or 2 months depending on width)
    const showLabel = activeTimeline.length <= 6 || idx % 2 === 0 || idx === activeTimeline.length - 1;
    if (showLabel) {
      ctx.fillStyle = '#475569';
      ctx.font = '11px Plus Jakarta Sans, sans-serif';
      const monthPart = pt.month.substring(5); // "08"
      const yearPart = pt.month.substring(2, 4); // "26"
      ctx.fillText(`${monthPart}/${yearPart}`, pt.x, height - 15);
    }
  });

  // 5. Update Statistics Row Cards below chart
  const startVal = values[0];
  const endVal = values[values.length - 1];
  const diff = endVal - startVal;
  const pctChange = ((diff / startVal) * 100).toFixed(1);
  const sign = diff >= 0 ? '+' : '';

  const movementElem = document.getElementById('stat-net-movement');
  movementElem.textContent = `${sign}${pctChange}% (${formatCurrency(diff)})`;
  movementElem.style.color = diff >= 0 ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-error)';

  const peakVal = Math.max(...values);
  const troughVal = Math.min(...values);
  document.getElementById('stat-peak').textContent = isPsf ? `$${formatNumber(peakVal)}/sqft` : formatCurrency(peakVal);
  document.getElementById('stat-trough').textContent = isPsf ? `$${formatNumber(troughVal)}/sqft` : formatCurrency(troughVal);

  const totalVol = activeTimeline.reduce((acc, curr) => acc + curr.volume, 0);
  document.getElementById('stat-total-volume').textContent = `${formatNumber(totalVol)} units`;

  // 6. Update Accessible HTML Table for Screen Readers
  renderAccessibleTrendTable(activeTimeline);
}

/**
 * Sets up mouse movement listener for the interactive crosshair and tooltip.
 */
function setupChartHover() {
  const canvas = document.getElementById('trend-chart-canvas');
  const tooltip = document.getElementById('chart-tooltip');
  if (!canvas || !tooltip) return;

  canvas.addEventListener('mousemove', (e) => {
    if (!AppState.chartRenderedPoints || AppState.chartRenderedPoints.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    // Find nearest point along X axis
    let closestPt = null;
    let minDist = Infinity;
    for (const pt of AppState.chartRenderedPoints) {
      const dist = Math.abs(pt.x - mouseX);
      if (dist < minDist) {
        minDist = dist;
        closestPt = pt;
      }
    }

    if (closestPt && minDist < 45) {
      tooltip.style.display = 'block';
      tooltip.style.left = `${closestPt.x}px`;
      tooltip.style.top = `${closestPt.y}px`;

      const isPsf = AppState.trendMetric === 'psf';
      const valStr = isPsf ? `$${formatNumber(closestPt.val)}/sqft` : formatCurrency(closestPt.val);

      tooltip.innerHTML = `
        <strong>${escapeHtml(closestPt.month)}</strong><br/>
        Median: ${valStr}<br/>
        Volume: ${closestPt.volume} transactions
      `;
    } else {
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });
}

/**
 * Populates screen reader accessible table.
 * @param {Array} timeline 
 */
function renderAccessibleTrendTable(timeline) {
  const tbody = document.getElementById('accessible-trend-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  timeline.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(item.month)}</td>
      <td>${formatCurrency(item.medianPrice)}</td>
      <td>$${formatNumber(item.medianPsf)}</td>
      <td>${item.volume}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ==========================================================================
   6. DOCUMENTATION ADVISOR MODULE
   ========================================================================== */

/**
 * Initializes Documentation Advisor checklist from static reviewed JSON data.
 */
async function initDocumentationAdvisor() {
  try {
    const res = await fetch('/data/document-checklists.json');
    const data = await res.json();
    AppState.docChecklistData = data;

    // Load saved checklist items from localStorage
    const saved = localStorage.getItem('sg_prop_completed_steps');
    if (saved) {
      AppState.userCompletedSteps = new Set(JSON.parse(saved));
    }

    // Bind profile selectors
    const citizenSelect = document.getElementById('doc-citizenship');
    const propSelect = document.getElementById('doc-property-type');
    const countSelect = document.getElementById('doc-property-count');
    const priceInput = document.getElementById('doc-price-input');

    const updateView = () => {
      calculateStampDuties();
      renderDocumentChecklists();
    };

    if (citizenSelect) citizenSelect.addEventListener('change', updateView);
    if (propSelect) propSelect.addEventListener('change', updateView);
    if (countSelect) countSelect.addEventListener('change', updateView);
    if (priceInput) priceInput.addEventListener('input', debounce(calculateStampDuties, 200));

    // Render glossary & initial profile
    renderGlossary();
    updateView();

  } catch (err) {
    console.error('Failed to load document checklists:', err);
  }
}

/**
 * Calculates Buyer's Stamp Duty (BSD) and Additional Buyer's Stamp Duty (ABSD)
 * based on statutory rates from the reviewed JSON configuration.
 */
function calculateStampDuties() {
  const data = AppState.docChecklistData;
  if (!data) return;

  const price = parseFloat(document.getElementById('doc-price-input').value) || 0;
  const citizenship = document.getElementById('doc-citizenship').value; // 'sc', 'pr', 'foreigner'
  const propertyCount = parseInt(document.getElementById('doc-property-count').value, 10) || 1;

  // 1. Calculate BSD according to Singapore IRAS tiered brackets:
  // First $180k @ 1%, Next $180k @ 2%, Next $640k @ 3%, Next $500k @ 4%, Next $1.5M @ 5%, Above $3M @ 6%
  let bsd = 0;
  let remaining = price;

  const tiers = [
    { cap: 180000, rate: 0.01 },
    { cap: 180000, rate: 0.02 },
    { cap: 640000, rate: 0.03 },
    { cap: 500000, rate: 0.04 },
    { cap: 1500000, rate: 0.05 },
    { cap: Infinity, rate: 0.06 }
  ];

  for (const t of tiers) {
    if (remaining <= 0) break;
    const taxable = Math.min(remaining, t.cap);
    bsd += taxable * t.rate;
    remaining -= taxable;
  }

  // 2. Calculate ABSD according to citizenship and count
  let absdRate = 0;
  let absdLabel = '0%';

  if (citizenship === 'sc') {
    if (propertyCount === 1) { absdRate = 0.00; absdLabel = '0% (1st property)'; }
    else if (propertyCount === 2) { absdRate = 0.20; absdLabel = '20% (2nd property)'; }
    else { absdRate = 0.30; absdLabel = '30% (3rd+ property)'; }
  } else if (citizenship === 'pr') {
    if (propertyCount === 1) { absdRate = 0.05; absdLabel = '5% (1st property)'; }
    else if (propertyCount === 2) { absdRate = 0.30; absdLabel = '30% (2nd property)'; }
    else { absdRate = 0.35; absdLabel = '35% (3rd+ property)'; }
  } else {
    // Foreigner
    absdRate = 0.60;
    absdLabel = '60% (Foreigner)';
  }

  const absd = price * absdRate;
  const totalDuty = bsd + absd;

  document.getElementById('calc-bsd-val').textContent = formatCurrency(bsd);
  document.getElementById('calc-absd-label').textContent = `Additional Buyer's Stamp Duty (ABSD) [${absdLabel}]:`;
  document.getElementById('calc-absd-val').textContent = formatCurrency(absd);
  document.getElementById('calc-total-stamp-val').textContent = formatCurrency(totalDuty);
}

/**
 * Renders the milestone process steps and required documents.
 */
function renderDocumentChecklists() {
  const data = AppState.docChecklistData;
  if (!data) return;

  const citizenship = document.getElementById('doc-citizenship').value;
  const propType = document.getElementById('doc-property-type').value;

  // Resolve matching profile key
  let profileKey = 'sc_hdb_resale';
  if (citizenship === 'sc' && propType === 'hdb_resale') profileKey = 'sc_hdb_resale';
  else if (citizenship === 'pr' && propType === 'hdb_resale') profileKey = 'pr_hdb_resale';
  else if (citizenship === 'sc' && propType === 'private_resale') profileKey = 'sc_private_resale';
  else if (citizenship === 'foreigner') profileKey = 'foreigner_private';
  else profileKey = 'sc_private_resale';

  const profile = data.profiles[profileKey] || data.profiles['sc_hdb_resale'];

  // Render Process Steps
  const timelineContainer = document.getElementById('checklist-timeline-container');
  timelineContainer.innerHTML = '';

  let completedCount = 0;
  profile.steps.forEach(step => {
    const isChecked = AppState.userCompletedSteps.has(step.id);
    if (isChecked) completedCount++;

    const stepElem = document.createElement('div');
    stepElem.className = 'checklist-step' + (isChecked ? ' completed' : '');
    stepElem.id = `wrapper-${step.id}`;

    stepElem.innerHTML = `
      <div class="step-checkbox-wrap">
        <input type="checkbox" class="step-checkbox" id="chk-${step.id}" ${isChecked ? 'checked' : ''} aria-label="Mark ${escapeHtml(step.title)} as completed" />
      </div>
      <div class="step-content">
        <div class="step-title">${escapeHtml(step.title)}</div>
        <div class="step-timeline-tag">${escapeHtml(step.timeline)}</div>
        <div class="step-desc">${escapeHtml(step.description)}</div>
      </div>
    `;

    const checkbox = stepElem.querySelector('.step-checkbox');
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        AppState.userCompletedSteps.add(step.id);
        stepElem.classList.add('completed');
      } else {
        AppState.userCompletedSteps.delete(step.id);
        stepElem.classList.remove('completed');
      }
      localStorage.setItem('sg_prop_completed_steps', JSON.stringify(Array.from(AppState.userCompletedSteps)));
      updateProgressBadge(profile.steps.length);
    });

    timelineContainer.appendChild(stepElem);
  });

  updateProgressBadge(profile.steps.length);

  // Render Required Documents
  const docsContainer = document.getElementById('required-docs-container');
  docsContainer.innerHTML = '';
  profile.requiredDocuments.forEach(doc => {
    const docElem = document.createElement('div');
    docElem.className = 'checklist-step';
    docElem.innerHTML = `
      <div class="step-content">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong class="step-title">${escapeHtml(doc.name)}</strong>
          <span class="badge-tag">${escapeHtml(doc.category)}</span>
        </div>
        <div class="step-desc">${escapeHtml(doc.description)}</div>
      </div>
    `;
    docsContainer.appendChild(docElem);
  });
}

/**
 * Updates progress badge (e.g. "3 of 9 completed").
 * @param {number} totalSteps 
 */
function updateProgressBadge(totalSteps) {
  const badge = document.getElementById('progress-tag');
  const count = AppState.userCompletedSteps.size;
  if (badge) {
    badge.textContent = `${count} of ${totalSteps} completed`;
  }
}

/**
 * Renders the Singapore property acronyms guide.
 */
function renderGlossary() {
  const data = AppState.docChecklistData;
  if (!data || !data.glossary) return;

  const container = document.getElementById('glossary-container');
  container.innerHTML = '';

  data.glossary.forEach(g => {
    const box = document.createElement('div');
    box.className = 'trend-stat-card';
    box.innerHTML = `
      <div style="font-weight: 700; color: var(--md-sys-color-primary); margin-bottom: 0.2rem;">
        ${escapeHtml(g.term)}
      </div>
      <div style="font-size: 0.8125rem; color: var(--md-sys-color-on-surface-variant);">
        ${escapeHtml(g.definition)}
      </div>
    `;
    container.appendChild(box);
  });
}

/* ==========================================================================
   7. AMENITIES OVERVIEW & LEAFLET MAP MODULE
   ========================================================================== */

/**
 * Initializes Leaflet map with OpenStreetMap tiles and custom property marker.
 */
function initAmenities() {
  const mapElement = document.getElementById('amenities-map');
  if (!mapElement || typeof L === 'undefined') return;

  // Center on Ang Mo Kio by default
  const defaultCoord = [AppState.currentLocation.lat, AppState.currentLocation.lng];
  const map = L.map('amenities-map').setView(defaultCoord, 15);
  AppState.leafletMap = map;

  // Add OpenStreetMap cartography tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors, OneMap Singapore SLA',
    maxZoom: 19
  }).addTo(map);

  // Markers layer group
  AppState.mapMarkersLayer = L.layerGroup().addTo(map);

  // Address search autocomplete for Amenities panel
  setupAddressAutocomplete('amenity-address-input', 'amenity-dropdown', (selectedPlace) => {
    AppState.currentLocation = {
      lat: selectedPlace.latitude,
      lng: selectedPlace.longitude,
      address: selectedPlace.address,
      town: selectedPlace.town
    };
    fetchAmenities();
  });

  // Search button
  const searchBtn = document.getElementById('btn-search-amenities');
  if (searchBtn) {
    searchBtn.addEventListener('click', fetchAmenities);
  }

  // Radius select
  const radiusSelect = document.getElementById('amenity-radius-select');
  if (radiusSelect) {
    radiusSelect.addEventListener('change', fetchAmenities);
  }

  // Category filter chips
  const chips = document.querySelectorAll('.filter-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      AppState.selectedAmenityCategory = chip.getAttribute('data-category') || 'all';
      filterAndRenderAmenitiesList();
    });
  });

  // Initial amenities load
  fetchAmenities();
}

/**
 * Fetches nearby amenities from /api/amenities and renders markers and list.
 */
async function fetchAmenities() {
  const { lat, lng } = AppState.currentLocation;
  const radius = document.getElementById('amenity-radius-select')?.value || 1000;

  const loadingState = document.getElementById('amenities-loading-state');
  const errorState = document.getElementById('amenities-error-state');
  const listContainer = document.getElementById('amenities-list-items');

  if (loadingState) loadingState.style.display = 'flex';
  if (errorState) errorState.style.display = 'none';
  if (listContainer) listContainer.style.opacity = '0.4';

  try {
    const res = await fetch(`/api/amenities?lat=${lat}&lng=${lng}&radius=${radius}`);
    const data = await res.json();

    if (loadingState) loadingState.style.display = 'none';
    if (listContainer) listContainer.style.opacity = '1';

    if (!data.success) {
      if (errorState) errorState.style.display = 'flex';
      document.getElementById('amenities-error-desc').textContent = data.error || 'Failed to locate amenities.';
      return;
    }

    AppState.amenitiesItems = data.items || [];

    // Update Category Counts
    document.getElementById('count-all').textContent = data.summary.totalCount;
    document.getElementById('count-mrt').textContent = data.summary.mrtCount;
    document.getElementById('count-school').textContent = data.summary.schoolCount;
    document.getElementById('count-hawker').textContent = data.summary.hawkerCount;
    document.getElementById('count-mall').textContent = data.summary.mallCount;
    document.getElementById('count-park').textContent = data.summary.parkCount;

    // Nearest MRT Hero
    if (data.nearestMrt) {
      document.getElementById('nearest-mrt-name').textContent = `${data.nearestMrt.name} (${data.nearestMrt.details})`;
      document.getElementById('nearest-mrt-distance').textContent = `${data.nearestMrt.distanceMeters}m away • Approximately ${data.nearestMrt.walkingMinutes} mins walk`;
    }

    // Render Map Markers
    renderMapMarkers(lat, lng, radius, AppState.amenitiesItems);

    // Render List
    filterAndRenderAmenitiesList();

  } catch (err) {
    console.error('Amenities error:', err);
    if (loadingState) loadingState.style.display = 'none';
    if (errorState) errorState.style.display = 'flex';
    document.getElementById('amenities-error-desc').textContent = err.message || 'Amenities lookup failed.';
  }
}

/**
 * Draws property center marker and amenity POI markers on Leaflet map.
 * @param {number} lat 
 * @param {number} lng 
 * @param {number} radius 
 * @param {Array} items 
 */
function renderMapMarkers(lat, lng, radius, items) {
  if (!AppState.leafletMap || !AppState.mapMarkersLayer) return;

  AppState.mapMarkersLayer.clearLayers();

  // 1. Center Property Marker (Blue Icon with pulsing radius circle)
  const propertyIcon = L.divIcon({
    className: 'custom-property-pin',
    html: `<div style="background-color: #0f375f; color: #fff; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 11px; border: 3px solid #fff; box-shadow: 0 3px 8px rgba(0,0,0,0.35);">HOME</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });

  L.marker([lat, lng], { icon: propertyIcon })
    .bindPopup(`<strong>Selected Property</strong><br/>${escapeHtml(AppState.currentLocation.address)}`)
    .addTo(AppState.mapMarkersLayer);

  // Search radius boundary circle
  L.circle([lat, lng], {
    radius: parseInt(radius, 10),
    color: '#0f375f',
    fillColor: '#0f375f',
    fillOpacity: 0.06,
    weight: 1.5,
    dashArray: '4, 4'
  }).addTo(AppState.mapMarkersLayer);

  // 2. Add POI Amenity Markers
  const colorMap = {
    mrt: '#059669',    // Green
    school: '#2563eb', // Blue
    hawker: '#d97706', // Orange
    mall: '#7c3aed',   // Purple
    park: '#10b981'    // Emerald
  };

  const labelMap = {
    mrt: 'MRT',
    school: 'SCH',
    hawker: 'FOOD',
    mall: 'MALL',
    park: 'PARK'
  };

  items.forEach(item => {
    const color = colorMap[item.category] || '#475569';
    const tag = labelMap[item.category] || 'POI';

    const poiIcon = L.divIcon({
      className: 'custom-poi-pin',
      html: `<div style="background-color: ${color}; color: #ffffff; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 9px; border: 2px solid #ffffff; box-shadow: 0 2px 5px rgba(0,0,0,0.25);">${tag}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const marker = L.marker([item.lat, item.lng], { icon: poiIcon })
      .bindPopup(`
        <strong>${escapeHtml(item.name)}</strong><br/>
        <em>${escapeHtml(item.categoryLabel)}</em><br/>
        Distance: ${item.distanceMeters}m (${item.walkingMinutes} min walk)<br/>
        ${escapeHtml(item.details)}
      `);

    AppState.mapMarkersLayer.addLayer(marker);
  });

  // Pan map smoothly to the selected location
  AppState.leafletMap.setView([lat, lng], 15);
}

/**
 * Filters amenities by selected category chip and renders the sidebar list.
 */
function filterAndRenderAmenitiesList() {
  const container = document.getElementById('amenities-list-items');
  if (!container) return;

  container.innerHTML = '';
  const cat = AppState.selectedAmenityCategory;
  const filtered = cat === 'all' 
    ? AppState.amenitiesItems 
    : AppState.amenitiesItems.filter(i => i.category === cat);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="padding: 1.5rem; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 0.875rem;">
        No ${cat.toUpperCase()} facilities found within this search radius. Try expanding to 1.5 km or 2 km.
      </div>
    `;
    return;
  }

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = 'amenity-card';
    card.innerHTML = `
      <div class="amenity-left">
        <div class="amenity-name">${escapeHtml(item.name)}</div>
        <div class="amenity-type">${escapeHtml(item.details)}</div>
      </div>
      <div class="amenity-right">
        <span class="distance-badge">${item.distanceMeters}m</span>
        <span class="walk-time">~${item.walkingMinutes} mins walk</span>
      </div>
    `;

    // Clicking card opens popup on map
    card.addEventListener('click', () => {
      if (AppState.leafletMap) {
        AppState.leafletMap.setView([item.lat, item.lng], 16);
      }
    });

    container.appendChild(card);
  });
}

/* ==========================================================================
   6. ACCOUNT CREATION & USER PROFILES
   ========================================================================== */

/**
 * Initializes the Create Account module:
 * - View switching (Home Buyer, Real Estate Agent, Side-by-Side)
 * - Home Buyer account registration and validation
 * - Real Estate Agent account registration with CEA number validation
 * - Account persistence in localStorage
 * - Dynamic profile rendering and quick-jump navigation to Price Advisor
 */
function initAccountModule() {
  const formsWrapper = document.getElementById('account-forms-wrapper');
  const btnShowBuyer = document.getElementById('btn-show-buyer-form');
  const btnShowAgent = document.getElementById('btn-show-agent-form');
  const btnShowBoth = document.getElementById('btn-show-both-forms');
  const loggedInCard = document.getElementById('account-logged-in-card');
  const headerBtn = document.getElementById('header-btn-create-account');
  const headerBtnLabel = document.getElementById('header-btn-account-label');

  // Agency license map
  const agencyLicenseMap = {
    'PropNex Realty Pte Ltd': 'L3008022J',
    'ERA Realty Network Pte Ltd': 'L3002382K',
    'Huttons Asia Pte Ltd': 'L3008899K',
    'OrangeTee & Tie Pte Ltd': 'L3009250K',
    'SRI Pte Ltd': 'L3010738A'
  };

  const agentAgencySelect = document.getElementById('agent-agency');
  const agentLicenseInput = document.getElementById('agent-agency-license');
  if (agentAgencySelect && agentLicenseInput) {
    agentAgencySelect.addEventListener('change', () => {
      const selected = agentAgencySelect.value;
      if (agencyLicenseMap[selected]) {
        agentLicenseInput.value = agencyLicenseMap[selected];
      } else {
        agentLicenseInput.value = '';
      }
    });
  }

  // Handle Switcher Buttons
  const switcherBtns = [btnShowBuyer, btnShowAgent, btnShowBoth].filter(Boolean);
  switcherBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switcherBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (!formsWrapper) return;
      formsWrapper.classList.remove('show-buyer', 'show-agent', 'show-both');

      if (btn === btnShowBuyer) {
        formsWrapper.classList.add('show-buyer');
      } else if (btn === btnShowAgent) {
        formsWrapper.classList.add('show-agent');
      } else if (btn === btnShowBoth) {
        formsWrapper.classList.add('show-both');
      }
    });
  });

  // Render Saved Account
  function renderSavedAccount() {
    let savedAccount = null;
    try {
      const raw = localStorage.getItem('dreamHome_account');
      if (raw) savedAccount = JSON.parse(raw);
    } catch (e) {
      console.warn('Error reading saved account:', e);
    }

    if (!savedAccount || !savedAccount.fullName) {
      if (loggedInCard) loggedInCard.style.display = 'none';
      if (headerBtnLabel) headerBtnLabel.textContent = 'Create Account';
      if (headerBtn) headerBtn.classList.remove('signed-in');
      return;
    }

    // Display Logged-In Card
    if (loggedInCard) {
      loggedInCard.style.display = 'block';

      const userNameEl = document.getElementById('account-user-name');
      const userEmailEl = document.getElementById('account-user-email');
      const typeBadgeEl = document.getElementById('account-type-badge');
      const detailsGrid = document.getElementById('account-details-content');

      if (userNameEl) userNameEl.textContent = savedAccount.fullName;
      if (userEmailEl) userEmailEl.textContent = savedAccount.email;

      if (typeBadgeEl) {
        if (savedAccount.role === 'buyer') {
          typeBadgeEl.textContent = 'Verified Home Buyer';
          typeBadgeEl.className = 'account-badge-pill buyer-pill';
        } else {
          typeBadgeEl.textContent = `CEA Registered Agent (${savedAccount.ceaNumber || 'Licensed'})`;
          typeBadgeEl.className = 'account-badge-pill agent-pill';
        }
      }

      if (detailsGrid) {
        detailsGrid.innerHTML = '';
        const items = [];

        if (savedAccount.role === 'buyer') {
          items.push({ label: 'Profile Type', val: savedAccount.buyerType || 'Citizen Buyer' });
          items.push({ label: 'Target Property', val: savedAccount.targetProperty || 'HDB 4-Room' });
          items.push({ label: 'Target Budget', val: savedAccount.budget || '$500k - $700k' });
          items.push({ label: 'Preferred Town', val: savedAccount.preferredTown || 'Ang Mo Kio' });
          items.push({ label: 'IPA / HFE Status', val: savedAccount.ipaStatus || 'Approved' });
          items.push({ label: 'Contact', val: `+65 ${savedAccount.phone}` });
        } else {
          items.push({ label: 'CEA Registration', val: savedAccount.ceaNumber });
          items.push({ label: 'Agency', val: savedAccount.agency });
          items.push({ label: 'License No.', val: savedAccount.agencyLicense || 'L3008022J' });
          items.push({ label: 'Advisory Focus', val: savedAccount.specialization });
          items.push({ label: 'Primary District', val: savedAccount.primaryDistrict });
          items.push({ label: 'Contact', val: `+65 ${savedAccount.phone}` });
        }

        items.forEach(item => {
          const div = document.createElement('div');
          div.className = 'account-detail-item';
          div.innerHTML = `
            <div class="account-detail-label">${escapeHtml(item.label)}</div>
            <div class="account-detail-val">${escapeHtml(item.val)}</div>
          `;
          detailsGrid.appendChild(div);
        });
      }
    }

    // Update Header Button
    if (headerBtnLabel) {
      const firstName = savedAccount.fullName.split(' ')[0] || 'My Account';
      headerBtnLabel.textContent = firstName;
    }
    if (headerBtn) {
      headerBtn.classList.add('signed-in');
    }
  }

  // Home Buyer Form Submit
  const formBuyer = document.getElementById('form-buyer-account');
  if (formBuyer) {
    formBuyer.addEventListener('submit', (e) => {
      e.preventDefault();

      const fullName = (document.getElementById('buyer-fullname')?.value || '').trim();
      const email = (document.getElementById('buyer-email')?.value || '').trim();
      const phone = (document.getElementById('buyer-phone')?.value || '').trim();
      const buyerType = document.getElementById('buyer-type')?.value || '';
      const targetProperty = document.getElementById('buyer-property-interest')?.value || '';
      const budget = document.getElementById('buyer-budget')?.value || '';
      const preferredTown = document.getElementById('buyer-preferred-town')?.value || '';
      const ipaStatus = document.getElementById('buyer-ipa-status')?.value || '';
      const password = document.getElementById('buyer-password')?.value || '';
      const confirmPassword = document.getElementById('buyer-confirm-password')?.value || '';
      const termsAgree = document.getElementById('buyer-terms-agree')?.checked;

      if (!fullName) {
        alert('Please enter your full name.');
        return;
      }
      if (!email || !email.includes('@')) {
        alert('Please enter a valid email address.');
        return;
      }
      if (!phone || phone.length < 8) {
        alert('Please enter an 8-digit Singapore contact number.');
        return;
      }
      if (!password || password.length < 8) {
        alert('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        alert('Passwords do not match. Please re-enter your password.');
        return;
      }
      if (!termsAgree) {
        alert('Please accept the Terms of Service & Privacy Policy to continue.');
        return;
      }

      const buyerAccount = {
        role: 'buyer',
        fullName,
        email,
        phone,
        buyerType,
        targetProperty,
        budget,
        preferredTown,
        ipaStatus,
        createdAt: new Date().toISOString()
      };

      try {
        localStorage.setItem('dreamHome_account', JSON.stringify(buyerAccount));
      } catch (err) {
        console.error('Failed to save account:', err);
      }

      renderSavedAccount();
      formBuyer.reset();
      
      const panel = document.getElementById('panel-create-account');
      if (panel) panel.scrollIntoView({ behavior: 'smooth' });

      alert(`🎉 Welcome to Dream Home, ${fullName}! Your Home Buyer account has been created successfully.`);
    });
  }

  // Real Estate Agent Form Submit
  const formAgent = document.getElementById('form-agent-account');
  if (formAgent) {
    formAgent.addEventListener('submit', (e) => {
      e.preventDefault();

      const fullName = (document.getElementById('agent-fullname')?.value || '').trim();
      const ceaNumber = (document.getElementById('agent-cea-number')?.value || '').trim().toUpperCase();
      const agency = document.getElementById('agent-agency')?.value || '';
      const agencyLicense = (document.getElementById('agent-agency-license')?.value || '').trim();
      const email = (document.getElementById('agent-email')?.value || '').trim();
      const phone = (document.getElementById('agent-phone')?.value || '').trim();
      const specialization = document.getElementById('agent-specialization')?.value || '';
      const primaryDistrict = document.getElementById('agent-primary-district')?.value || '';
      const password = document.getElementById('agent-password')?.value || '';
      const confirmPassword = document.getElementById('agent-confirm-password')?.value || '';
      const ceaAgree = document.getElementById('agent-cea-code-agree')?.checked;

      if (!fullName) {
        alert('Please enter your full name as registered with CEA.');
        return;
      }
      const ceaRegex = /^[Rr][0-9]{6}[A-Za-z]$/;
      if (!ceaNumber || !ceaRegex.test(ceaNumber)) {
        alert('Please enter a valid CEA Registration Number in the format R012345A (R + 6 digits + 1 letter).');
        return;
      }
      if (!agency) {
        alert('Please select your licensed estate agency.');
        return;
      }
      if (!email || !email.includes('@')) {
        alert('Please enter a valid business/agency email address.');
        return;
      }
      if (!phone || phone.length < 8) {
        alert('Please enter an 8-digit Singapore contact number.');
        return;
      }
      if (!password || password.length < 8) {
        alert('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        alert('Passwords do not match. Please re-enter your password.');
        return;
      }
      if (!ceaAgree) {
        alert('Please confirm agreement to the CEA Code of Ethics & Professional Conduct.');
        return;
      }

      const agentAccount = {
        role: 'agent',
        fullName,
        ceaNumber,
        agency,
        agencyLicense,
        email,
        phone,
        specialization,
        primaryDistrict,
        createdAt: new Date().toISOString()
      };

      try {
        localStorage.setItem('dreamHome_account', JSON.stringify(agentAccount));
      } catch (err) {
        console.error('Failed to save account:', err);
      }

      renderSavedAccount();
      formAgent.reset();

      const panel = document.getElementById('panel-create-account');
      if (panel) panel.scrollIntoView({ behavior: 'smooth' });

      alert(`🎉 Welcome to Dream Home, ${fullName}! Your Real Estate Agent (CEA) profile has been verified and registered.`);
    });
  }

  // Sign Out / Switch Account
  const btnSignOut = document.getElementById('btn-account-sign-out');
  if (btnSignOut) {
    btnSignOut.addEventListener('click', () => {
      if (confirm('Are you sure you want to sign out? You can register or log in with another account anytime.')) {
        localStorage.removeItem('dreamHome_account');
        renderSavedAccount();
      }
    });
  }

  // Explore Price Advisor Shortcut
  const btnGotoAdvisor = document.getElementById('btn-account-goto-advisor');
  if (btnGotoAdvisor) {
    btnGotoAdvisor.addEventListener('click', () => {
      let saved = null;
      try {
        const raw = localStorage.getItem('dreamHome_account');
        if (raw) saved = JSON.parse(raw);
      } catch (e) {}

      if (saved && saved.preferredTown) {
        const townSelect = document.getElementById('search-town');
        if (townSelect) townSelect.value = saved.preferredTown;
      }

      const advisorTab = document.getElementById('tab-price-advisor');
      if (advisorTab) advisorTab.click();
    });
  }

  // Initial render on load
  renderSavedAccount();
}

/* ==========================================================================
   INITIALIZATION
   ========================================================================== */

// Bootstrap all modules once DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initPriceAdvisor();
  initLocationComparison();
  initPriceTrends();
  initDocumentationAdvisor();
  initAmenities();
  initAccountModule();
});
