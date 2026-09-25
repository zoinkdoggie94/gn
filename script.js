"use strict";

/* ============================================================
   GN-SHRUB
   ============================================================ */


/* ------------------------------------------------------------
   DOM
------------------------------------------------------------ */

const container = document.getElementById("container");
const featuredContainer = document.getElementById("featuredZones");

const zoneViewer = document.getElementById("zoneViewer");
const zoneFrame = document.getElementById("zoneFrame");

const searchBar = document.getElementById("searchBar");
const sortOptions = document.getElementById("sortOptions");
const filterOptions = document.getElementById("filterOptions");

const refreshButton = document.getElementById("refresh");

const settingsButton = document.getElementById("settings");

const popupOverlay = document.getElementById("popupOverlay");
const popupTitle = document.getElementById("popupTitle");
const popupBody = document.getElementById("popupBody");

const loadStatus = document.getElementById("loadStatus");
const toastElement = document.getElementById("toast");


/* ------------------------------------------------------------
   VERIFIED GN-MATH MIRROR SOURCES
------------------------------------------------------------ */

const zonesURL =
    "https://cdn.jsdelivr.net/gh/freebuisness/assets@main/zones.json";

const htmlURL =
    "https://cdn.jsdelivr.net/gh/freebuisness/html@main";

const coverURL =
    "https://cdn.jsdelivr.net/gh/freebuisness/covers@main";


/*
    Popularity is optional.

    If this endpoint ever fails, GN-Shrub still works normally.
    Only the "Popular" ordering loses its hit-count information.
*/

const popularityURL =
    "https://data.jsdelivr.com/v1/stats/packages/gh/freebuisness/html@main/files?period=year";


/* ------------------------------------------------------------
   STATE
------------------------------------------------------------ */

let zones = [];

let popularityData = {};

let currentZone = null;

let zonesRequestController = null;

let toastTimer = null;

let routeIsBeingHandled = false;


/* ------------------------------------------------------------
   HELPERS
------------------------------------------------------------ */

function toTitleCase(value) {
    return String(value || "")
        .replace(
            /\w\S*/g,
            word =>
                word.charAt(0).toUpperCase() +
                word.substring(1).toLowerCase()
        );
}


function zoneURL(value) {
    return String(value || "")
        .replace(/\{COVER_URL\}/g, coverURL)
        .replace(/\{HTML_URL\}/g, htmlURL);
}


function cacheBust(url) {
    const parsed = new URL(url, window.location.href);

    parsed.searchParams.set("_gnshrub", Date.now());

    return parsed.href;
}


function setLoadStatus(message) {
    if (!loadStatus) {
        return;
    }

    loadStatus.textContent = message || "";
}


function showToast(message, timeout = 2400) {
    if (!toastElement) {
        return;
    }

    clearTimeout(toastTimer);

    toastElement.textContent = message;

    toastElement.classList.add("show");

    toastTimer = setTimeout(() => {
        toastElement.classList.remove("show");
    }, timeout);
}


function safeExternalHref(value) {
    if (!value) {
        return null;
    }

    try {
        const url = new URL(value, window.location.href);

        if (
            url.protocol !== "http:" &&
            url.protocol !== "https:"
        ) {
            return null;
        }

        return url.href;
    } catch {
        return null;
    }
}


function safeFileName(value) {
    const result = String(value || "zone")
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);

    return result || "zone";
}


function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* ------------------------------------------------------------
   GAME HTML BASE HANDLING

   Games are fetched from jsDelivr and written into our iframe.

   A <base> tag makes relative resources such as:
       script.js
       style.css
       assets/file.png
       Build/game.wasm

   resolve against the actual game's CDN directory instead of
   accidentally resolving against the GN-Shrub website.
------------------------------------------------------------ */

function zoneBaseFor(url) {
    try {
        return new URL(".", url).href;
    } catch {
        return url;
    }
}


function injectZoneBase(html, url) {
    const baseURL = zoneBaseFor(url);

    const safeBase =
        String(baseURL)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;");

    const baseTag =
        `<base href="${safeBase}">`;

    const existingBase =
        /<base\b[^>]*>/i;

    if (existingBase.test(html)) {
        return html.replace(
            existingBase,
            baseTag
        );
    }

    const headTag =
        /<head\b[^>]*>/i;

    if (headTag.test(html)) {
        return html.replace(
            headTag,
            match =>
                `${match}\n${baseTag}`
        );
    }

    const htmlTag =
        /<html\b[^>]*>/i;

    if (htmlTag.test(html)) {
        return html.replace(
            htmlTag,
            match =>
                `${match}\n<head>${baseTag}</head>`
        );
    }

    return (
        `<!DOCTYPE html>` +
        `<html>` +
        `<head>${baseTag}</head>` +
        `<body>${html}</body>` +
        `</html>`
    );
}


/* ------------------------------------------------------------
   FETCH HELPERS
------------------------------------------------------------ */

async function fetchTextChecked(url, options = {}) {
    const response = await fetch(
        url,
        {
            cache: "no-store",
            ...options
        }
    );

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status} while loading ${url}`
        );
    }

    return response.text();
}


async function fetchJSONChecked(url, options = {}) {
    const response = await fetch(
        url,
        {
            cache: "no-store",
            ...options
        }
    );

    if (!response.ok) {
        throw new Error(
            `HTTP ${response.status} while loading ${url}`
        );
    }

    return response.json();
}


/* ------------------------------------------------------------
   POPULARITY
------------------------------------------------------------ */

async function fetchPopularity() {
    popularityData = {};

    try {
        const data =
            await fetchJSONChecked(
                popularityURL
            );

        if (!Array.isArray(data)) {
            return;
        }

        for (const file of data) {
            const name =
                String(file?.name || "");

            const idMatch =
                name.match(
                    /\/(\d+)\.html$/i
                );

            if (!idMatch) {
                continue;
            }

            const id =
                Number(idMatch[1]);

            const hits =
                Number(
                    file?.hits?.total ??
                    file?.hits ??
                    0
                );

            if (
                Number.isFinite(id) &&
                Number.isFinite(hits)
            ) {
                popularityData[id] = hits;
            }
        }
    } catch (error) {
        /*
            Popularity is intentionally non-critical.

            Do not prevent the entire site from loading just because
            jsDelivr's statistics endpoint is temporarily unavailable.
        */

        console.warn(
            "Popularity data unavailable:",
            error
        );
    }
}


/* ------------------------------------------------------------
   LOAD ZONES
------------------------------------------------------------ */

async function listZones() {
    if (zonesRequestController) {
        zonesRequestController.abort();
    }

    zonesRequestController =
        new AbortController();

    const signal =
        zonesRequestController.signal;

    refreshButton?.classList.add(
        "is-loading"
    );

    if (refreshButton) {
        refreshButton.disabled = true;
    }

    setLoadStatus(
        "Loading zones..."
    );

    if (!zones.length) {
        container.innerHTML =
            `<div class="loading-message">Loading...</div>`;
    }

    try {
        const popularityPromise =
            fetchPopularity();

        const json =
            await fetchJSONChecked(
                cacheBust(zonesURL),
                { signal }
            );

        if (!Array.isArray(json)) {
            throw new Error(
                "zones.json did not return an array."
            );
        }

        zones =
            json.filter(
                zone =>
                    zone &&
                    typeof zone === "object" &&
                    zone.name != null &&
                    zone.url != null
            );

        if (zones.length) {
            /*
                GN-Math traditionally keeps its first special entry
                featured. Preserve that behavior.
            */

            zones[0].featured = true;
        }

        await popularityPromise;

        buildTagOptions();

        sortZones();

        setLoadStatus(
            `${zones.length.toLocaleString()} zones loaded`
        );

        await openZoneFromCurrentURL();

    } catch (error) {
        if (
            error?.name ===
            "AbortError"
        ) {
            return;
        }

        console.error(
            "Unable to load zones:",
            error
        );

        setLoadStatus(
            "Unable to load zones."
        );

        container.innerHTML = `
            <div class="error-message">
                Could not load zones.<br>
                ${escapeHTML(error.message)}
            </div>
        `;
    } finally {
        refreshButton?.classList.remove(
            "is-loading"
        );

        if (refreshButton) {
            refreshButton.disabled = false;
        }
    }
}


/* ------------------------------------------------------------
   TAGS
------------------------------------------------------------ */

function buildTagOptions() {
    const previousValue =
        filterOptions.value;

    const tags = new Set();

    for (const zone of zones) {
        if (!Array.isArray(zone.special)) {
            continue;
        }

        for (const tag of zone.special) {
            if (
                typeof tag === "string" &&
                tag.trim()
            ) {
                tags.add(tag.trim());
            }
        }
    }

    const sortedTags =
        [...tags].sort(
            (a, b) =>
                a.localeCompare(
                    b,
                    undefined,
                    {
                        sensitivity: "base"
                    }
                )
        );

    filterOptions.innerHTML = "";

    const allOption =
        document.createElement("option");

    allOption.value = "none";
    allOption.textContent = "Tag";

    filterOptions.appendChild(
        allOption
    );

    for (const tag of sortedTags) {
        const option =
            document.createElement("option");

        option.value = tag;
        option.textContent =
            toTitleCase(tag);

        filterOptions.appendChild(
            option
        );
    }

    if (
        [...filterOptions.options]
            .some(
                option =>
                    option.value ===
                    previousValue
            )
    ) {
        filterOptions.value =
            previousValue;
    }
}


/* ------------------------------------------------------------
   SORTING
------------------------------------------------------------ */

function sortZoneList(list) {
    const sorted =
        [...list];

    const sortBy =
        sortOptions.value;

    if (sortBy === "id") {
        sorted.sort(
            (a, b) =>
                Number(b.id || 0) -
                Number(a.id || 0)
        );
    }

    else if (sortBy === "popular") {
        sorted.sort(
            (a, b) => {
                const aPopularity =
                    Number(
                        a.popularity ??
                        popularityData[
                            Number(a.id)
                        ] ??
                        0
                    );

                const bPopularity =
                    Number(
                        b.popularity ??
                        popularityData[
                            Number(b.id)
                        ] ??
                        0
                    );

                if (
                    bPopularity !==
                    aPopularity
                ) {
                    return (
                        bPopularity -
                        aPopularity
                    );
                }

                return (
                    Number(b.id || 0) -
                    Number(a.id || 0)
                );
            }
        );
    }

    else {
        sorted.sort(
            (a, b) =>
                String(a.name || "")
                    .localeCompare(
                        String(
                            b.name || ""
                        ),
                        undefined,
                        {
                            sensitivity:
                                "base"
                        }
                    )
        );
    }

    /*
        Preserve special -1 entries at the top.
    */

    sorted.sort(
        (a, b) => {
            if (a.id === -1) {
                return -1;
            }

            if (b.id === -1) {
                return 1;
            }

            return 0;
        }
    );

    return sorted;
}


function sortZones() {
    renderZones();
}


/* ------------------------------------------------------------
   FILTERING
------------------------------------------------------------ */

function getFilteredZones() {
    const query =
        searchBar.value
            .trim()
            .toLowerCase();

    const tag =
        filterOptions.value;

    return zones.filter(
        zone => {
            const name =
                String(
                    zone.name || ""
                ).toLowerCase();

            const author =
                String(
                    zone.author || ""
                ).toLowerCase();

            const specials =
                Array.isArray(
                    zone.special
                )
                    ? zone.special
                    : [];

            const matchesSearch =
                !query ||
                name.includes(query) ||
                author.includes(query);

            const matchesTag =
                tag === "none" ||
                specials.includes(tag);

            return (
                matchesSearch &&
                matchesTag
            );
        }
    );
}


function filterZones() {
    if (
        searchBar.value.trim()
    ) {
        document
            .getElementById(
                "featuredZonesWrapper"
            )
            ?.removeAttribute(
                "open"
            );
    }

    renderZones();
}


function filterZones2() {
    if (
        filterOptions.value !==
        "none"
    ) {
        document
            .getElementById(
                "featuredZonesWrapper"
            )
            ?.removeAttribute(
                "open"
            );
    }

    renderZones();
}


/* ------------------------------------------------------------
   CARD CREATION
------------------------------------------------------------ */

function createZoneCard(file) {
    const zoneItem =
        document.createElement("article");

    zoneItem.className =
        "zone-item";

    zoneItem.tabIndex = 0;

    const image =
        document.createElement("img");

    image.alt =
        String(file.name || "Zone");

    image.loading = "lazy";

    image.decoding = "async";

    image.referrerPolicy =
        "no-referrer";

    const resolvedCover =
        zoneURL(
            file.cover ||
            "favicon.png"
        );

    image.src =
        resolvedCover ||
        "favicon.png";

    let fallbackUsed = false;

    image.addEventListener(
        "error",
        () => {
            if (fallbackUsed) {
                return;
            }

            fallbackUsed = true;

            image.src =
                "favicon.png";
        }
    );

    const button =
        document.createElement(
            "button"
        );

    button.type = "button";

    const title =
        document.createElement(
            "span"
        );

    title.className =
        "zone-title-text";

    title.textContent =
        String(
            file.name ||
            "Unnamed Zone"
        );

    button.appendChild(
        title
    );

    button.addEventListener(
        "click",
        event => {
            event.stopPropagation();

            openZone(file);
        }
    );

    zoneItem.addEventListener(
        "click",
        () => {
            openZone(file);
        }
    );

    zoneItem.addEventListener(
        "keydown",
        event => {
            if (
                event.key === "Enter" ||
                event.key === " "
            ) {
                event.preventDefault();

                openZone(file);
            }
        }
    );

    zoneItem.append(
        image,
        button
    );

    return zoneItem;
}


/* ------------------------------------------------------------
   RENDER
------------------------------------------------------------ */

function displayFeaturedZones(
    featuredZones
) {
    featuredContainer.innerHTML =
        "";

    if (!featuredZones.length) {
        featuredContainer.innerHTML = `
            <div class="empty-message">
                No featured zones found.
            </div>
        `;

        document.getElementById(
            "allZonesSummary"
        ).textContent =
            "Featured Zones";

        return;
    }

    const fragment =
        document.createDocumentFragment();

    for (
        const file
        of featuredZones
    ) {
        fragment.appendChild(
            createZoneCard(file)
        );
    }

    featuredContainer.appendChild(
        fragment
    );

    document.getElementById(
        "allZonesSummary"
    ).textContent =
        `Featured Zones (${featuredZones.length})`;
}


function displayZones(
    displayedZones
) {
    container.innerHTML = "";

    if (!displayedZones.length) {
        container.innerHTML = `
            <div class="empty-message">
                No zones match your search.
            </div>
        `;

        document.getElementById(
            "allSummary"
        ).textContent =
            "All Zones (0)";

        return;
    }

    const fragment =
        document.createDocumentFragment();

    for (
        const file
        of displayedZones
    ) {
        fragment.appendChild(
            createZoneCard(file)
        );
    }

    container.appendChild(
        fragment
    );

    document.getElementById(
        "allSummary"
    ).textContent =
        `All Zones (${displayedZones.length})`;
}


function renderZones() {
    const filtered =
        getFilteredZones();

    const sorted =
        sortZoneList(filtered);

    displayZones(sorted);

    const featured =
        sortZoneList(
            zones.filter(
                zone =>
                    zone.featured
            )
        );

    displayFeaturedZones(
        featured
    );
}


/* ------------------------------------------------------------
   IFRAME WRITING
------------------------------------------------------------ */

function writeHTMLToZoneFrame(html) {
    const frameDocument =
        zoneFrame.contentDocument ||
        zoneFrame.contentWindow
            ?.document;

    if (!frameDocument) {
        throw new Error(
            "Unable to access the game frame."
        );
    }

    frameDocument.open();

    frameDocument.write(
        html
    );

    frameDocument.close();
}


/* ------------------------------------------------------------
   OPEN ZONE
------------------------------------------------------------ */

async function openZone(
    file,
    options = {}
) {
    if (!file) {
        return;
    }

    const {
        updateHistory = true,
        embed = false
    } = options;

    const rawURL =
        String(file.url || "");

    if (!rawURL) {
        showToast(
            "This zone does not have a URL."
        );

        return;
    }

    /*
        Some entries intentionally point directly to external sites.
    */

    if (
        /^https?:\/\//i.test(
            rawURL
        )
    ) {
        window.open(
            rawURL,
            "_blank",
            "noopener,noreferrer"
        );

        return;
    }

    const url =
        zoneURL(rawURL);

    if (!url) {
        showToast(
            "Unable to resolve this zone."
        );

        return;
    }

    currentZone = file;

    if (embed) {
        document.body.classList.add(
            "embed-mode"
        );
    } else {
        document.body.classList.remove(
            "embed-mode"
        );
    }

    document.getElementById(
        "zoneName"
    ).textContent =
        String(
            file.name ||
            "Zone"
        );

    document.getElementById(
        "zoneId"
    ).textContent =
        String(
            file.id ??
            ""
        );

    const author =
        document.getElementById(
            "zoneAuthor"
        );

    author.textContent =
        file.author
            ? `by ${file.author}`
            : "GN-Shrub";

    const authorHref =
        safeExternalHref(
            file.authorLink
        );

    if (authorHref) {
        author.href =
            authorHref;

        author.style.pointerEvents =
            "";
    } else {
        author.removeAttribute(
            "href"
        );

        author.style.pointerEvents =
            "none";
    }

    zoneViewer.hidden = false;

    zoneViewer.style.display =
        "flex";

    zoneViewer.setAttribute(
        "aria-hidden",
        "false"
    );

    document.body.classList.add(
        "viewer-open"
    );

    zoneFrame.src =
        "about:blank";

    setLoadStatus(
        `Opening ${file.name}...`
    );

    try {
        const html =
            await fetchTextChecked(
                cacheBust(url)
            );

        const fixedHTML =
            injectZoneBase(
                html,
                url
            );

        writeHTMLToZoneFrame(
            fixedHTML
        );

        setLoadStatus(
            `${zones.length.toLocaleString()} zones loaded`
        );

        if (
            updateHistory &&
            file.id != null
        ) {
            const pageURL =
                new URL(
                    window.location.href
                );

            pageURL.searchParams.set(
                "id",
                String(file.id)
            );

            history.pushState(
                {
                    zoneId:
                        String(file.id)
                },
                "",
                pageURL
            );
        }
    } catch (error) {
        console.error(
            "Failed to load zone:",
            error
        );

        closeZone({
            updateHistory: false
        });

        showToast(
            `Failed to load ${file.name}: ${error.message}`,
            4200
        );
    }
}


/* ------------------------------------------------------------
   URL ROUTING
------------------------------------------------------------ */

async function openZoneFromCurrentURL() {
    if (
        !zones.length ||
        routeIsBeingHandled
    ) {
        return;
    }

    const search =
        new URLSearchParams(
            window.location.search
        );

    const id =
        search.get("id");

    if (!id) {
        return;
    }

    const zone =
        zones.find(
            item =>
                String(item.id) ===
                String(id)
        );

    if (!zone) {
        return;
    }

    const embed =
        window.location.hash
            .toLowerCase()
            .includes("embed");

    routeIsBeingHandled = true;

    try {
        await openZone(
            zone,
            {
                updateHistory:
                    false,
                embed
            }
        );
    } finally {
        routeIsBeingHandled = false;
    }
}


window.addEventListener(
    "popstate",
    async () => {
        const search =
            new URLSearchParams(
                window.location.search
            );

        const id =
            search.get("id");

        if (!id) {
            closeZone({
                updateHistory: false
            });

            return;
        }

        const zone =
            zones.find(
                item =>
                    String(item.id) ===
                    String(id)
            );

        if (!zone) {
            return;
        }

        await openZone(
            zone,
            {
                updateHistory:
                    false,
                embed:
                    window.location.hash
                        .includes(
                            "embed"
                        )
            }
        );
    }
);


/* ------------------------------------------------------------
   CLOSE ZONE
------------------------------------------------------------ */

function closeZone(
    options = {}
) {
    const {
        updateHistory = true
    } = options;

    currentZone = null;

    zoneViewer.hidden = true;

    zoneViewer.style.display =
        "none";

    zoneViewer.setAttribute(
        "aria-hidden",
        "true"
    );

    document.body.classList.remove(
        "viewer-open",
        "embed-mode"
    );

    /*
        Resetting the iframe stops audio, timers and games that
        would otherwise keep running invisibly after closing.
    */

    zoneFrame.src =
        "about:blank";

    if (updateHistory) {
        const pageURL =
            new URL(
                window.location.href
            );

        pageURL.searchParams.delete(
            "id"
        );

        pageURL.hash = "";

        history.pushState(
            {},
            "",
            pageURL
        );
    }
}


/* ------------------------------------------------------------
   NEW TAB
------------------------------------------------------------ */

async function aboutBlank() {
    if (!currentZone) {
        showToast(
            "No zone is open."
        );

        return;
    }

    const rawURL =
        String(
            currentZone.url ||
            ""
        );

    if (
        /^https?:\/\//i.test(
            rawURL
        )
    ) {
        window.open(
            rawURL,
            "_blank",
            "noopener,noreferrer"
        );

        return;
    }

    /*
        Open immediately so browsers do not block the popup after
        the asynchronous fetch finishes.
    */

    const newWindow =
        window.open(
            "about:blank",
            "_blank"
        );

    if (!newWindow) {
        showToast(
            "Your browser blocked the new tab."
        );

        return;
    }

    try {
        newWindow.document.title =
            "Loading GN-Shrub...";

        newWindow.document.body.innerHTML =
            "<p style='font-family:system-ui;padding:20px'>Loading...</p>";

        const url =
            zoneURL(
                currentZone.url
            );

        const html =
            await fetchTextChecked(
                cacheBust(url)
            );

        const fixedHTML =
            injectZoneBase(
                html,
                url
            );

        newWindow.document.open();

        newWindow.document.write(
            fixedHTML
        );

        newWindow.document.close();
    } catch (error) {
        console.error(
            "Failed to open zone in new tab:",
            error
        );

        newWindow.document.open();

        newWindow.document.write(
            `<p style="font-family:system-ui;padding:20px">
                Failed to load this zone.
            </p>`
        );

        newWindow.document.close();
    }
}


/* ------------------------------------------------------------
   DOWNLOAD
------------------------------------------------------------ */

async function downloadZone() {
    if (!currentZone) {
        showToast(
            "No zone is open."
        );

        return;
    }

    const rawURL =
        String(
            currentZone.url ||
            ""
        );

    if (
        /^https?:\/\//i.test(
            rawURL
        )
    ) {
        showToast(
            "This zone is an external URL and cannot be exported as a local HTML file."
        );

        return;
    }

    try {
        const url =
            zoneURL(
                rawURL
            );

        const text =
            await fetchTextChecked(
                cacheBust(url)
            );

        /*
            Include the corrected base URL in downloaded copies too,
            so relative game files still have a chance to resolve.
        */

        const fixedText =
            injectZoneBase(
                text,
                url
            );

        const blob =
            new Blob(
                [fixedText],
                {
                    type:
                        "text/html;charset=utf-8"
                }
            );

        const objectURL =
            URL.createObjectURL(
                blob
            );

        const link =
            document.createElement(
                "a"
            );

        link.href =
            objectURL;

        link.download =
            `${safeFileName(
                currentZone.name
            )}.html`;

        document.body.appendChild(
            link
        );

        link.click();

        link.remove();

        setTimeout(
            () =>
                URL.revokeObjectURL(
                    objectURL
                ),
            1000
        );
    } catch (error) {
        console.error(
            "Download failed:",
            error
        );

        showToast(
            `Download failed: ${error.message}`,
            3500
        );
    }
}


/* ------------------------------------------------------------
   FULLSCREEN
------------------------------------------------------------ */

async function fullscreenZone() {
    try {
        if (
            document.fullscreenElement
        ) {
            await document.exitFullscreen();

            return;
        }

        if (
            zoneFrame.requestFullscreen
        ) {
            await zoneFrame.requestFullscreen();
        }

        else if (
            zoneFrame.webkitRequestFullscreen
        ) {
            zoneFrame.webkitRequestFullscreen();
        }

        else {
            showToast(
                "Fullscreen is not supported by this browser."
            );
        }
    } catch (error) {
        console.error(
            "Fullscreen failed:",
            error
        );

        showToast(
            "Unable to enter fullscreen."
        );
    }
}


/* ------------------------------------------------------------
   POPUP
------------------------------------------------------------ */

function openPopup(
    title,
    html
) {
    popupTitle.textContent =
        title;

    popupBody.innerHTML =
        html;

    popupOverlay.style.display =
        "flex";

    popupOverlay.setAttribute(
        "aria-hidden",
        "false"
    );
}


function closePopup() {
    popupOverlay.style.display =
        "none";

    popupOverlay.setAttribute(
        "aria-hidden",
        "true"
    );
}


popupOverlay.addEventListener(
    "click",
    event => {
        if (
            event.target ===
            popupOverlay
        ) {
            closePopup();
        }
    }
);


/* ------------------------------------------------------------
   SETTINGS
------------------------------------------------------------ */

settingsButton.addEventListener(
    "click",
    () => {
        openPopup(
            "Settings",
            `
                <button
                    class="settings-button"
                    type="button"
                    onclick="tabCloak()"
                >
                    Tab Cloak
                </button>

                <br><br>

                <button
                    class="settings-button secondary"
                    type="button"
                    onclick="resetTabCloak()"
                >
                    Reset Tab Appearance
                </button>

                <p style="
                    margin: 1rem 0 0;
                    font-size: .82rem;
                    color: var(--text-muted);
                ">
                    GN-Shrub stays in dark mode.
                </p>
            `
        );
    }
);


/* ------------------------------------------------------------
   TAB CLOAK
------------------------------------------------------------ */

function cloakName(value) {
    const title =
        String(value || "")
            .trim();

    document.title =
        title ||
        "GN-Shrub";

    if (title) {
        localStorage.setItem(
            "gnshrub-tab-title",
            title
        );
    } else {
        localStorage.removeItem(
            "gnshrub-tab-title"
        );
    }
}


function cloakIcon(value) {
    const icon =
        String(value || "")
            .trim();

    let link =
        document.querySelector(
            "link[rel~='icon']"
        );

    if (!link) {
        link =
            document.createElement(
                "link"
            );

        link.rel =
            "icon";

        document.head.appendChild(
            link
        );
    }

    link.href =
        icon ||
        "favicon.png";

    if (icon) {
        localStorage.setItem(
            "gnshrub-tab-icon",
            icon
        );
    } else {
        localStorage.removeItem(
            "gnshrub-tab-icon"
        );
    }
}


function tabCloak() {
    const currentTitle =
        localStorage.getItem(
            "gnshrub-tab-title"
        ) || "";

    const currentIcon =
        localStorage.getItem(
            "gnshrub-tab-icon"
        ) || "";

    openPopup(
        "Tab Cloak",
        `
            <label class="popup-field">
                <span>Tab Title</span>

                <input
                    type="text"
                    id="cloak-title-input"
                    value="${escapeHTML(currentTitle)}"
                    placeholder="Enter a new tab title..."
                >
            </label>

            <label class="popup-field">
                <span>Tab Icon URL</span>

                <input
                    type="url"
                    id="cloak-icon-input"
                    value="${escapeHTML(currentIcon)}"
                    placeholder="https://example.com/icon.png"
                >
            </label>

            <button
                class="settings-button"
                type="button"
                id="save-cloak-button"
            >
                Save
            </button>
        `
    );

    document
        .getElementById(
            "save-cloak-button"
        )
        .addEventListener(
            "click",
            () => {
                cloakName(
                    document.getElementById(
                        "cloak-title-input"
                    ).value
                );

                cloakIcon(
                    document.getElementById(
                        "cloak-icon-input"
                    ).value
                );

                closePopup();

                showToast(
                    "Tab appearance updated."
                );
            }
        );
}


function resetTabCloak() {
    localStorage.removeItem(
        "gnshrub-tab-title"
    );

    localStorage.removeItem(
        "gnshrub-tab-icon"
    );

    document.title =
        "GN-Shrub";

    cloakIcon("");

    closePopup();

    showToast(
        "Tab appearance reset."
    );
}


function restoreTabCloak() {
    const title =
        localStorage.getItem(
            "gnshrub-tab-title"
        );

    const icon =
        localStorage.getItem(
            "gnshrub-tab-icon"
        );

    if (title) {
        document.title =
            title;
    }

    if (icon) {
        cloakIcon(icon);
    }
}


/* ------------------------------------------------------------
   CONTACT / INFO
------------------------------------------------------------ */

function showContact() {
    openPopup(
        "Contact",
        `
            <h3>GN-Shrub</h3>

            <p>
                GN-Shrub is hosted at:
            </p>

            <p>
                <a
                    href="https://zoinkdoggie94.github.io/gn/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    zoinkdoggie94.github.io/gn/
                </a>
            </p>
        `
    );
}


function loadDMCA() {
    openPopup(
        "DMCA",
        `
            <div class="dmca-content">

                <h3>Content Removal</h3>

                <p>
                    GN-Shrub acts as a frontend for game entries
                    loaded from third-party sources.
                </p>

                <p>
                    If you own content displayed through GN-Shrub
                    and want the GN-Shrub site to stop listing it,
                    contact the maintainer of this site with the
                    game name and proof of ownership.
                </p>

            </div>
        `
    );
}


function loadPrivacy() {
    openPopup(
        "Privacy",
        `
            <div>

                <h2>GN-Shrub Privacy</h2>

                <p>
                    GN-Shrub itself does not require an account.
                </p>

                <p>
                    Search settings, tab appearance settings and
                    imported GN-Shrub settings may be stored locally
                    in your browser.
                </p>

                <p>
                    Games and other resources can be loaded from
                    third-party services. Those services may have
                    their own privacy policies and network logging.
                </p>

                <p>
                    The Export Data button exports GN-Shrub's
                    browser storage settings. It does not intentionally
                    export your browser cookies.
                </p>

            </div>
        `
    );
}


/* ------------------------------------------------------------
   DATA EXPORT

   Safer than the old implementation:
   - no cookie dumping
   - no arbitrary Cache Storage dumping
   - no whole IndexedDB database dumping

   It only exports GN-Shrub's local and session storage.
------------------------------------------------------------ */

function storageToObject(
    storage
) {
    const result = {};

    for (
        let index = 0;
        index < storage.length;
        index++
    ) {
        const key =
            storage.key(index);

        if (key == null) {
            continue;
        }

        result[key] =
            storage.getItem(key);
    }

    return result;
}


async function saveData() {
    try {
        const result = {
            application:
                "GN-Shrub",

            version:
                1,

            exportedAt:
                new Date()
                    .toISOString(),

            localStorage:
                storageToObject(
                    localStorage
                ),

            sessionStorage:
                storageToObject(
                    sessionStorage
                )
        };

        const blob =
            new Blob(
                [
                    JSON.stringify(
                        result,
                        null,
                        2
                    )
                ],
                {
                    type:
                        "application/json"
                }
            );

        const url =
            URL.createObjectURL(
                blob
            );

        const link =
            document.createElement(
                "a"
            );

        link.href =
            url;

        link.download =
            `gn-shrub-data-${Date.now()}.json`;

        document.body.appendChild(
            link
        );

        link.click();

        link.remove();

        setTimeout(
            () =>
                URL.revokeObjectURL(
                    url
                ),
            1000
        );

        showToast(
            "GN-Shrub data exported."
        );
    } catch (error) {
        console.error(
            "Export failed:",
            error
        );

        showToast(
            "Unable to export data."
        );
    }
}


/* ------------------------------------------------------------
   DATA IMPORT
------------------------------------------------------------ */

function restoreStorageObject(
    storage,
    value
) {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        return;
    }

    for (
        const [
            key,
            itemValue
        ]
        of Object.entries(value)
    ) {
        if (
            typeof key !==
            "string"
        ) {
            continue;
        }

        storage.setItem(
            key,
            String(
                itemValue ?? ""
            )
        );
    }
}


async function loadData(event) {
    const input =
        event.target;

    const file =
        input.files?.[0];

    if (!file) {
        return;
    }

    try {
        const text =
            await file.text();

        const data =
            JSON.parse(text);

        if (
            !data ||
            typeof data !== "object"
        ) {
            throw new Error(
                "Invalid data file."
            );
        }

        restoreStorageObject(
            localStorage,
            data.localStorage
        );

        restoreStorageObject(
            sessionStorage,
            data.sessionStorage
        );

        restoreTabCloak();

        showToast(
            "GN-Shrub data imported."
        );
    } catch (error) {
        console.error(
            "Import failed:",
            error
        );

        showToast(
            "That file could not be imported."
        );
    } finally {
        input.value = "";
    }
}


/* ------------------------------------------------------------
   DARK MODE

   GN-Shrub intentionally stays dark.
------------------------------------------------------------ */

function darkMode() {
    document.body.classList.add(
        "dark-mode"
    );
}


/* ------------------------------------------------------------
   KEYBOARD CONTROLS
------------------------------------------------------------ */

document.addEventListener(
    "keydown",
    event => {
        if (
            event.key !==
            "Escape"
        ) {
            return;
        }

        if (
            popupOverlay.style
                .display ===
            "flex"
        ) {
            closePopup();

            return;
        }

        if (
            !zoneViewer.hidden
        ) {
            closeZone();
        }
    }
);


/* ------------------------------------------------------------
   INITIALIZATION
------------------------------------------------------------ */

async function initializeGNshrub() {
    document.body.classList.add(
        "dark-mode"
    );

    restoreTabCloak();

    const search =
        new URLSearchParams(
            window.location.search
        );

    if (
        search.has(
            "privacy"
        )
    ) {
        loadPrivacy();
    }

    await listZones();
}


initializeGNshrub();
