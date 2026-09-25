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
let zoneFrame = document.getElementById("zoneFrame");

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
   GN-MATH MIRROR SOURCES
------------------------------------------------------------ */

const zonesURL =
    "https://cdn.jsdelivr.net/gh/freebuisness/assets@main/zones.json";

const htmlURL =
    "https://cdn.jsdelivr.net/gh/freebuisness/html@main";

const coverURL =
    "https://cdn.jsdelivr.net/gh/freebuisness/covers@main";


/*
    Popularity is optional.
    If this fails, the site still works.
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

let zoneOpenController = null;

let zoneOpenSequence = 0;

let routeIsBeingHandled = false;

let toastTimer = null;


/* ------------------------------------------------------------
   BASIC HELPERS
------------------------------------------------------------ */

function toTitleCase(value) {
    return String(value || "").replace(
        /\w\S*/g,
        word =>
            word.charAt(0).toUpperCase() +
            word.slice(1).toLowerCase()
    );
}


function zoneURL(value) {
    return String(value || "")
        .replace(/\{COVER_URL\}/g, coverURL)
        .replace(/\{HTML_URL\}/g, htmlURL);
}


function cacheBust(url) {
    try {
        const parsed = new URL(
            url,
            window.location.href
        );

        parsed.searchParams.set(
            "_gnshrub",
            Date.now()
        );

        return parsed.href;
    } catch {
        const separator =
            String(url).includes("?")
                ? "&"
                : "?";

        return (
            String(url) +
            separator +
            "_gnshrub=" +
            Date.now()
        );
    }
}


function setLoadStatus(message) {
    if (!loadStatus) {
        return;
    }

    loadStatus.textContent =
        String(message || "");
}


function showToast(
    message,
    timeout = 2400
) {
    if (!toastElement) {
        console.log(message);
        return;
    }

    clearTimeout(toastTimer);

    toastElement.textContent =
        String(message || "");

    toastElement.classList.add(
        "show"
    );

    toastTimer = setTimeout(
        () => {
            toastElement.classList.remove(
                "show"
            );
        },
        timeout
    );
}


function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function safeFileName(value) {
    const result =
        String(value || "zone")
            .replace(
                /[<>:"/\\|?*\u0000-\u001F]/g,
                "_"
            )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120);

    return result || "zone";
}


function safeExternalHref(value) {
    if (!value) {
        return null;
    }

    try {
        const url =
            new URL(
                value,
                window.location.href
            );

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


/* ------------------------------------------------------------
   FETCH HELPERS
------------------------------------------------------------ */

async function fetchTextChecked(
    url,
    options = {}
) {
    const response =
        await fetch(
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


async function fetchJSONChecked(
    url,
    options = {}
) {
    const response =
        await fetch(
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


/* ============================================================
   GAME HTML FIXING

   This is the important white-screen fix.

   Lots of GN-Math HTML launchers contain their OWN <base href>
   that points to wherever that game's real CSS / JS / WASM /
   images / Unity build actually live.

   We MUST preserve and resolve that declared base instead of
   replacing it with freebuisness/html@main/.
   ============================================================ */

const BASE_TAG_RE =
    /<base\b[^>]*>/i;

const BASE_HREF_RE =
    /<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>/i;


/* ------------------------------------------------------------
   REWRITE OLD DEAD GN-MATH CDN REFERENCES
------------------------------------------------------------ */

function rewriteKnownMirrorURLs(html) {
    let output =
        String(html || "");

    const replacements = [
        [
            /https:\/\/cdn\.jsdelivr\.net\/gh\/gn-math\/assets@(?:main|master|latest)/gi,
            "https://cdn.jsdelivr.net/gh/freebuisness/assets@main"
        ],

        [
            /https:\/\/cdn\.jsdelivr\.net\/gh\/gn-math\/html@(?:main|master|latest)/gi,
            "https://cdn.jsdelivr.net/gh/freebuisness/html@main"
        ],

        [
            /https:\/\/cdn\.jsdelivr\.net\/gh\/gn-math\/covers@(?:main|master|latest)/gi,
            "https://cdn.jsdelivr.net/gh/freebuisness/covers@main"
        ]
    ];

    for (
        const [
            pattern,
            replacement
        ]
        of replacements
    ) {
        output =
            output.replace(
                pattern,
                replacement
            );
    }

    return output;
}


/* ------------------------------------------------------------
   CLEAN WEIRD MIRRORED HTML
------------------------------------------------------------ */

function stripBrokenLeadingClosers(html) {
    let output =
        String(html || "");

    /*
        Some mirrored game HTML files start with:
        </script><!DOCTYPE html>

        An unmatched closing script tag before the document begins
        is useless and can make document.write parsing less reliable.
    */

    output =
        output.replace(
            /^\uFEFF/,
            ""
        );

    output =
        output.replace(
            /^\s*<\/script\s*>\s*(?=(?:<!doctype\s+html|<html\b|<head\b))/i,
            ""
        );

    return output;
}


/* ------------------------------------------------------------
   DETERMINE REAL GAME BASE
------------------------------------------------------------ */

function zoneBaseFor(
    url,
    html
) {
    const sourceURL =
        String(url || "");

    const slashIndex =
        sourceURL.lastIndexOf("/");

    const launcherFolder =
        slashIndex >= 0
            ? sourceURL.slice(
                0,
                slashIndex + 1
            )
            : sourceURL;

    let root;

    try {
        root =
            new URL(
                launcherFolder,
                document.baseURI
            ).href;
    } catch {
        root =
            launcherFolder;
    }

    /*
        Check whether the GAME ITSELF declared a base.

        Example:

        <base href="https://some-other-repo/game/">

        That URL is where its resources actually belong.
    */

    const match =
        String(html || "")
            .match(
                BASE_HREF_RE
            );

    const declared =
        match
            ? (
                match[1] !== undefined
                    ? match[1]
                    : match[2] !== undefined
                        ? match[2]
                        : match[3]
            )
            : "";

    if (!declared) {
        return root;
    }

    try {
        return new URL(
            declared,
            root
        ).href;
    } catch {
        return root;
    }
}


/* ------------------------------------------------------------
   INJECT / FIX BASE
------------------------------------------------------------ */

function injectZoneBase(
    html,
    url
) {
    let output =
        stripBrokenLeadingClosers(
            rewriteKnownMirrorURLs(
                html
            )
        );

    const baseURL =
        zoneBaseFor(
            url,
            output
        );

    const safeBase =
        String(baseURL)
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /"/g,
                "&quot;"
            );

    const baseTag =
        `<base href="${safeBase}">`;

    /*
        If the document already has <base>, keep its meaning,
        but make the resolved value absolute and reliable.
    */

    if (
        BASE_TAG_RE.test(
            output
        )
    ) {
        return output.replace(
            BASE_TAG_RE,
            baseTag
        );
    }

    /*
        Otherwise add a base pointing to the launcher directory.
    */

    if (
        /<head\b[^>]*>/i.test(
            output
        )
    ) {
        return output.replace(
            /<head\b[^>]*>/i,
            match =>
                `${match}\n${baseTag}`
        );
    }

    if (
        /<html\b[^>]*>/i.test(
            output
        )
    ) {
        return output.replace(
            /<html\b[^>]*>/i,
            match =>
                `${match}\n<head>${baseTag}</head>`
        );
    }

    return (
        `${baseTag}\n` +
        output
    );
}


function prepareGameHTML(
    html,
    url
) {
    return injectZoneBase(
        html,
        url
    );
}


/* ============================================================
   POPULARITY
   ============================================================ */

async function fetchPopularity() {
    popularityData = {};

    try {
        const data =
            await fetchJSONChecked(
                popularityURL
            );

        if (
            !Array.isArray(data)
        ) {
            return;
        }

        for (
            const file
            of data
        ) {
            const name =
                String(
                    file?.name ||
                    ""
                );

            const idMatch =
                name.match(
                    /\/(\d+)\.html$/i
                );

            if (!idMatch) {
                continue;
            }

            const id =
                Number(
                    idMatch[1]
                );

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
                popularityData[id] =
                    hits;
            }
        }
    } catch (error) {
        /*
            This should NEVER break game loading.
        */

        console.warn(
            "Popularity data unavailable:",
            error
        );
    }
}


/* ============================================================
   LOAD ZONES
   ============================================================ */

async function listZones() {
    /*
        Cancel an older refresh if another refresh starts.
    */

    if (
        zonesRequestController
    ) {
        zonesRequestController.abort();
    }

    zonesRequestController =
        new AbortController();

    const signal =
        zonesRequestController.signal;

    if (refreshButton) {
        refreshButton.classList.add(
            "is-loading"
        );

        refreshButton.disabled =
            true;
    }

    setLoadStatus(
        "Loading zones..."
    );

    if (!zones.length) {
        container.innerHTML =
            `<div class="loading-message">Loading...</div>`;
    }

    try {
        /*
            Popularity can happen in parallel.
            It is optional.
        */

        const popularityPromise =
            fetchPopularity();

        const json =
            await fetchJSONChecked(
                cacheBust(
                    zonesURL
                ),
                {
                    signal
                }
            );

        if (
            !Array.isArray(json)
        ) {
            throw new Error(
                "zones.json did not return an array."
            );
        }

        zones =
            json.filter(
                zone =>
                    zone &&
                    typeof zone ===
                        "object" &&
                    zone.name != null &&
                    zone.url != null
            );

        /*
            Preserve GN-Math's first-entry featured behavior.
        */

        if (zones.length) {
            zones[0].featured =
                true;
        }

        await popularityPromise;

        buildTagOptions();

        renderZones();

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
        if (refreshButton) {
            refreshButton.classList.remove(
                "is-loading"
            );

            refreshButton.disabled =
                false;
        }
    }
}


/* ============================================================
   TAG OPTIONS
   ============================================================ */

function buildTagOptions() {
    if (!filterOptions) {
        return;
    }

    const previousValue =
        filterOptions.value;

    const tags =
        new Set();

    for (
        const zone
        of zones
    ) {
        if (
            !Array.isArray(
                zone.special
            )
        ) {
            continue;
        }

        for (
            const tag
            of zone.special
        ) {
            if (
                typeof tag ===
                    "string" &&
                tag.trim()
            ) {
                tags.add(
                    tag.trim()
                );
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
                        sensitivity:
                            "base"
                    }
                )
        );

    filterOptions.innerHTML =
        "";

    const allOption =
        document.createElement(
            "option"
        );

    allOption.value =
        "none";

    allOption.textContent =
        "Tag";

    filterOptions.appendChild(
        allOption
    );

    for (
        const tag
        of sortedTags
    ) {
        const option =
            document.createElement(
                "option"
            );

        option.value =
            tag;

        option.textContent =
            toTitleCase(tag);

        filterOptions.appendChild(
            option
        );
    }

    const stillExists =
        [...filterOptions.options]
            .some(
                option =>
                    option.value ===
                    previousValue
            );

    filterOptions.value =
        stillExists
            ? previousValue
            : "none";
}


/* ============================================================
   SORTING
   ============================================================ */

function sortZoneList(list) {
    const sorted =
        [...list];

    const sortBy =
        sortOptions?.value ||
        "name";

    if (
        sortBy ===
        "id"
    ) {
        sorted.sort(
            (a, b) =>
                Number(
                    b.id || 0
                ) -
                Number(
                    a.id || 0
                )
        );
    }

    else if (
        sortBy ===
        "popular"
    ) {
        sorted.sort(
            (a, b) => {
                const aPopularity =
                    Number(
                        a.popularity ??
                        popularityData[
                            Number(
                                a.id
                            )
                        ] ??
                        0
                    );

                const bPopularity =
                    Number(
                        b.popularity ??
                        popularityData[
                            Number(
                                b.id
                            )
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
                    Number(
                        b.id || 0
                    ) -
                    Number(
                        a.id || 0
                    )
                );
            }
        );
    }

    else {
        sorted.sort(
            (a, b) =>
                String(
                    a.name || ""
                )
                    .localeCompare(
                        String(
                            b.name ||
                            ""
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
        Keep special -1 entries at the top.
    */

    sorted.sort(
        (a, b) => {
            if (
                Number(a.id) ===
                -1
            ) {
                return -1;
            }

            if (
                Number(b.id) ===
                -1
            ) {
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


/* ============================================================
   FILTERING
   ============================================================ */

function getFilteredZones() {
    const query =
        String(
            searchBar?.value ||
            ""
        )
            .trim()
            .toLowerCase();

    const tag =
        filterOptions?.value ||
        "none";

    return zones.filter(
        zone => {
            const name =
                String(
                    zone.name ||
                    ""
                )
                    .toLowerCase();

            const author =
                String(
                    zone.author ||
                    ""
                )
                    .toLowerCase();

            const id =
                String(
                    zone.id ??
                    ""
                )
                    .toLowerCase();

            const specials =
                Array.isArray(
                    zone.special
                )
                    ? zone.special
                    : [];

            const matchesSearch =
                !query ||
                name.includes(
                    query
                ) ||
                author.includes(
                    query
                ) ||
                id.includes(
                    query
                );

            const matchesTag =
                tag === "none" ||
                specials.includes(
                    tag
                );

            return (
                matchesSearch &&
                matchesTag
            );
        }
    );
}


function filterZones() {
    if (
        searchBar?.value
            .trim()
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
        filterOptions?.value !==
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


/* ============================================================
   ZONE CARDS
   ============================================================ */

function createZoneCard(file) {
    const zoneItem =
        document.createElement(
            "article"
        );

    zoneItem.className =
        "zone-item";

    zoneItem.tabIndex =
        0;

    const image =
        document.createElement(
            "img"
        );

    image.alt =
        String(
            file.name ||
            "Zone"
        );

    image.loading =
        "lazy";

    image.decoding =
        "async";

    image.referrerPolicy =
        "no-referrer";

    const resolvedCover =
        file.cover
            ? zoneURL(
                file.cover
            )
            : "favicon.png";

    image.src =
        resolvedCover ||
        "favicon.png";

    let fallbackUsed =
        false;

    image.addEventListener(
        "error",
        () => {
            if (
                fallbackUsed
            ) {
                return;
            }

            fallbackUsed =
                true;

            image.src =
                "favicon.png";
        }
    );

    const button =
        document.createElement(
            "button"
        );

    button.type =
        "button";

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
                event.key ===
                    "Enter" ||
                event.key ===
                    " "
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


/* ============================================================
   RENDER FEATURED
   ============================================================ */

function displayFeaturedZones(
    featuredZones
) {
    if (!featuredContainer) {
        return;
    }

    featuredContainer.innerHTML =
        "";

    if (
        !featuredZones.length
    ) {
        featuredContainer.innerHTML = `
            <div class="empty-message">
                No featured zones found.
            </div>
        `;

        const summary =
            document.getElementById(
                "allZonesSummary"
            );

        if (summary) {
            summary.textContent =
                "Featured Zones";
        }

        return;
    }

    const fragment =
        document.createDocumentFragment();

    for (
        const file
        of featuredZones
    ) {
        fragment.appendChild(
            createZoneCard(
                file
            )
        );
    }

    featuredContainer.appendChild(
        fragment
    );

    const summary =
        document.getElementById(
            "allZonesSummary"
        );

    if (summary) {
        summary.textContent =
            `Featured Zones (${featuredZones.length})`;
    }
}


/* ============================================================
   RENDER ALL
   ============================================================ */

function displayZones(
    displayedZones
) {
    if (!container) {
        return;
    }

    container.innerHTML =
        "";

    if (
        !displayedZones.length
    ) {
        container.innerHTML = `
            <div class="empty-message">
                No zones match your search.
            </div>
        `;

        const summary =
            document.getElementById(
                "allSummary"
            );

        if (summary) {
            summary.textContent =
                "All Zones (0)";
        }

        return;
    }

    const fragment =
        document.createDocumentFragment();

    for (
        const file
        of displayedZones
    ) {
        fragment.appendChild(
            createZoneCard(
                file
            )
        );
    }

    container.appendChild(
        fragment
    );

    const summary =
        document.getElementById(
            "allSummary"
        );

    if (summary) {
        summary.textContent =
            `All Zones (${displayedZones.length})`;
    }
}


function renderZones() {
    const filtered =
        getFilteredZones();

    const sorted =
        sortZoneList(
            filtered
        );

    displayZones(
        sorted
    );

    const featured =
        sortZoneList(
            zones.filter(
                zone =>
                    Boolean(
                        zone.featured
                    )
            )
        );

    displayFeaturedZones(
        featured
    );
}


/* ============================================================
   IFRAME MANAGEMENT
   ============================================================ */

function createFreshZoneFrame() {
    const freshFrame =
        document.createElement(
            "iframe"
        );

    freshFrame.id =
        "zoneFrame";

    freshFrame.title =
        "GN-Shrub game";

    freshFrame.allow =
        "autoplay; fullscreen; gamepad; pointer-lock; clipboard-read; clipboard-write";

    freshFrame.allowFullscreen =
        true;

    freshFrame.setAttribute(
        "allowfullscreen",
        ""
    );

    /*
        IMPORTANT:
        Do NOT sandbox this iframe.
        Many HTML5/Unity games need scripts, pointer lock,
        storage and fullscreen.
    */

    if (
        zoneFrame &&
        zoneFrame.parentNode
    ) {
        zoneFrame.parentNode
            .replaceChild(
                freshFrame,
                zoneFrame
            );
    }

    else if (zoneViewer) {
        zoneViewer.appendChild(
            freshFrame
        );
    }

    zoneFrame =
        freshFrame;

    return zoneFrame;
}


function writeHTMLToZoneFrame(html) {
    const frame =
        createFreshZoneFrame();

    const frameDocument =
        frame.contentDocument ||
        frame.contentWindow
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

    return frame;
}


/* ============================================================
   VIEWER METADATA
   ============================================================ */

function showZoneViewer(
    file,
    embed = false
) {
    currentZone =
        file;

    if (embed) {
        document.body.classList.add(
            "embed-mode"
        );
    } else {
        document.body.classList.remove(
            "embed-mode"
        );
    }

    const nameElement =
        document.getElementById(
            "zoneName"
        );

    const idElement =
        document.getElementById(
            "zoneId"
        );

    const authorElement =
        document.getElementById(
            "zoneAuthor"
        );

    if (nameElement) {
        nameElement.textContent =
            String(
                file?.name ||
                "Zone"
            );
    }

    if (idElement) {
        idElement.textContent =
            String(
                file?.id ??
                ""
            );
    }

    if (authorElement) {
        authorElement.textContent =
            file?.author
                ? `by ${file.author}`
                : "GN-Shrub";

        const authorHref =
            safeExternalHref(
                file?.authorLink
            );

        if (authorHref) {
            authorElement.href =
                authorHref;

            authorElement.style
                .pointerEvents =
                "";
        } else {
            authorElement.removeAttribute(
                "href"
            );

            authorElement.style
                .pointerEvents =
                "none";
        }
    }

    if (zoneViewer) {
        zoneViewer.hidden =
            false;

        zoneViewer.style.display =
            "flex";

        zoneViewer.setAttribute(
            "aria-hidden",
            "false"
        );
    }

    document.body.classList.add(
        "viewer-open"
    );
}


/* ============================================================
   YOUTUBE PLAYABLES
   ============================================================ */

function looksLikeYouTubePlayable(html) {
    const source =
        String(html || "");

    return (
        /ytgame/i.test(
            source
        ) ||
        /youtube\s*playables?/i.test(
            source
        )
    );
}


function showYouTubePlayablePopup(
    file,
    html,
    url
) {
    currentZone =
        file;

    openPopup(
        String(
            file?.name ||
            "YouTube Playable"
        ),
        `
            <p style="margin-top:0;">
                This game is a YouTube Playables title and needs to open in its own tab.
            </p>

            <button
                class="settings-button"
                type="button"
                id="ytOpenBtn"
            >
                Open in New Tab
            </button>
        `
    );

    const button =
        document.getElementById(
            "ytOpenBtn"
        );

    if (!button) {
        return;
    }

    button.addEventListener(
        "click",
        () => {
            const newWindow =
                window.open(
                    "about:blank",
                    "_blank"
                );

            if (!newWindow) {
                showToast(
                    "Your browser blocked the new tab. Allow popups and try again.",
                    3800
                );

                return;
            }

            try {
                const prepared =
                    prepareGameHTML(
                        html,
                        url
                    );

                newWindow.document.open();

                newWindow.document.write(
                    prepared
                );

                newWindow.document.close();

                closePopup();
            } catch (error) {
                console.error(
                    "Failed to open YouTube Playable:",
                    error
                );

                try {
                    newWindow.close();
                } catch {}

                showToast(
                    `Failed to open ${file?.name || "game"}.`,
                    3500
                );
            }
        },
        {
            once: true
        }
    );
}


/* ============================================================
   OPEN GAME
   ============================================================ */

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
        String(
            file.url ||
            ""
        )
            .trim();

    if (!rawURL) {
        showToast(
            "This zone does not have a URL."
        );

        return;
    }

    /*
        GN-Math entries that use a completely external URL
        intentionally open as separate sites.
    */

    if (
        /^https?:\/\//i.test(
            rawURL
        )
    ) {
        const externalURL =
            safeExternalHref(
                rawURL
            );

        if (!externalURL) {
            showToast(
                "This zone has an invalid external URL."
            );

            return;
        }

        window.open(
            externalURL,
            "_blank",
            "noopener,noreferrer"
        );

        return;
    }

    const url =
        zoneURL(
            rawURL
        );

    if (!url) {
        showToast(
            "Unable to resolve this zone."
        );

        return;
    }

    /*
        Cancel a game that is still fetching if another game
        gets clicked before it finishes.
    */

    if (
        zoneOpenController
    ) {
        zoneOpenController.abort();
    }

    zoneOpenController =
        new AbortController();

    const signal =
        zoneOpenController.signal;

    const sequence =
        ++zoneOpenSequence;

    currentZone =
        file;

    setLoadStatus(
        `Opening ${file.name || "zone"}...`
    );

    try {
        const html =
            await fetchTextChecked(
                cacheBust(
                    url
                ),
                {
                    signal
                }
            );

        /*
            A newer click happened while this one was downloading.
        */

        if (
            sequence !==
            zoneOpenSequence
        ) {
            return;
        }

        if (
            !String(html || "")
                .trim()
        ) {
            throw new Error(
                "The game launcher returned an empty document."
            );
        }

        /*
            Detect common CDN error pages instead of pretending
            they are game HTML.
        */

        if (
            /couldn['’]?\s*find\s+the\s+requested\s+file/i.test(
                html
            ) ||
            /package\s+size\s+exceeded/i.test(
                html
            )
        ) {
            throw new Error(
                "The game launcher could not be loaded from the mirror."
            );
        }

        /*
            Some YouTube Playables do not behave correctly inside
            the normal GN-Shrub iframe.
        */

        if (
            looksLikeYouTubePlayable(
                html
            )
        ) {
            showYouTubePlayablePopup(
                file,
                html,
                url
            );

            setLoadStatus(
                `${zones.length.toLocaleString()} zones loaded`
            );

            return;
        }

        /*
            THIS fixes the white screen:
            preserve the game's actual declared asset base.
        */

        const preparedHTML =
            prepareGameHTML(
                html,
                url
            );

        /*
            Update UI first.
        */

        showZoneViewer(
            file,
            embed
        );

        /*
            Fresh iframe every time.
        */

        writeHTMLToZoneFrame(
            preparedHTML
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
                String(
                    file.id
                )
            );

            if (embed) {
                pageURL.hash =
                    "embed";
            }

            history.pushState(
                {
                    zoneId:
                        String(
                            file.id
                        )
                },
                "",
                pageURL
            );
        }
    } catch (error) {
        if (
            error?.name ===
            "AbortError"
        ) {
            return;
        }

        console.error(
            "Failed to load zone:",
            error
        );

        if (
            sequence ===
            zoneOpenSequence
        ) {
            closeZone({
                updateHistory:
                    false
            });
        }

        setLoadStatus(
            `${zones.length.toLocaleString()} zones loaded`
        );

        showToast(
            `Failed to load ${file.name || "zone"}: ${error.message}`,
            4600
        );
    }
}


/* ============================================================
   OPEN GAME FROM ?id=
   ============================================================ */

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
        search.get(
            "id"
        );

    if (!id) {
        return;
    }

    const zone =
        zones.find(
            item =>
                String(
                    item.id
                ) ===
                String(
                    id
                )
        );

    if (!zone) {
        return;
    }

    const embed =
        window.location.hash
            .toLowerCase()
            .includes(
                "embed"
            );

    routeIsBeingHandled =
        true;

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
        routeIsBeingHandled =
            false;
    }
}


/* ============================================================
   BROWSER BACK / FORWARD
   ============================================================ */

window.addEventListener(
    "popstate",
    async () => {
        const search =
            new URLSearchParams(
                window.location.search
            );

        const id =
            search.get(
                "id"
            );

        if (!id) {
            closeZone({
                updateHistory:
                    false
            });

            return;
        }

        const zone =
            zones.find(
                item =>
                    String(
                        item.id
                    ) ===
                    String(
                        id
                    )
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
                        .toLowerCase()
                        .includes(
                            "embed"
                        )
            }
        );
    }
);


/* ============================================================
   CLOSE GAME
   ============================================================ */

function closeZone(
    options = {}
) {
    const {
        updateHistory = true
    } = options;

    if (
        zoneOpenController
    ) {
        zoneOpenController.abort();

        zoneOpenController =
            null;
    }

    /*
        Invalidate any previously-started async opener.
    */

    zoneOpenSequence +=
        1;

    currentZone =
        null;

    if (zoneViewer) {
        zoneViewer.hidden =
            true;

        zoneViewer.style.display =
            "none";

        zoneViewer.setAttribute(
            "aria-hidden",
            "true"
        );
    }

    document.body.classList.remove(
        "viewer-open",
        "embed-mode"
    );

    /*
        Completely replace the iframe.

        This kills:
        - audio
        - game loops
        - web workers
        - timers
        - navigation state
        - old game scripts
    */

    if (
        zoneFrame &&
        zoneFrame.parentNode
    ) {
        const freshFrame =
            document.createElement(
                "iframe"
            );

        freshFrame.id =
            "zoneFrame";

        freshFrame.title =
            "GN-Shrub game";

        freshFrame.allow =
            "autoplay; fullscreen; gamepad; pointer-lock; clipboard-read; clipboard-write";

        freshFrame.allowFullscreen =
            true;

        freshFrame.setAttribute(
            "allowfullscreen",
            ""
        );

        zoneFrame.parentNode
            .replaceChild(
                freshFrame,
                zoneFrame
            );

        zoneFrame =
            freshFrame;
    }

    if (updateHistory) {
        try {
            const pageURL =
                new URL(
                    window.location.href
                );

            pageURL.searchParams.delete(
                "id"
            );

            pageURL.hash =
                "";

            history.pushState(
                {},
                "",
                pageURL
            );
        } catch {}
    }
}


/* ============================================================
   OPEN IN NEW TAB
   ============================================================ */

async function aboutBlank() {
    if (!currentZone) {
        showToast(
            "No zone is open."
        );

        return;
    }

    const zoneAtClick =
        currentZone;

    const rawURL =
        String(
            zoneAtClick.url ||
            ""
        )
            .trim();

    if (!rawURL) {
        showToast(
            "This zone does not have a URL."
        );

        return;
    }

    /*
        Completely external zones can simply open directly.
    */

    if (
        /^https?:\/\//i.test(
            rawURL
        )
    ) {
        const directURL =
            safeExternalHref(
                rawURL
            );

        if (directURL) {
            window.open(
                directURL,
                "_blank",
                "noopener,noreferrer"
            );
        }

        return;
    }

    /*
        MUST create about:blank synchronously here,
        before awaiting fetch(), otherwise Safari and other
        browsers can treat it as a popup and block it.
    */

    const newWindow =
        window.open(
            "about:blank",
            "_blank"
        );

    if (!newWindow) {
        showToast(
            "Your browser blocked the new tab. Allow popups and try again.",
            3800
        );

        return;
    }

    try {
        /*
            Show something instead of a completely blank tab
            while the launcher downloads.
        */

        newWindow.document.open();

        newWindow.document.write(`
            <!doctype html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <meta
                        name="viewport"
                        content="width=device-width,initial-scale=1"
                    >
                    <title>Loading GN-Shrub...</title>

                    <style>
                        html,
                        body {
                            width: 100%;
                            height: 100%;
                            margin: 0;
                        }

                        body {
                            display: grid;
                            place-items: center;

                            background: #07110b;
                            color: #e2e8f0;

                            font-family:
                                system-ui,
                                -apple-system,
                                sans-serif;
                        }

                        p {
                            opacity: .8;
                        }
                    </style>
                </head>

                <body>
                    <p>
                        Loading ${escapeHTML(
                            zoneAtClick.name ||
                            "game"
                        )}...
                    </p>
                </body>
            </html>
        `);

        newWindow.document.close();

        const url =
            zoneURL(
                rawURL
            );

        const html =
            await fetchTextChecked(
                cacheBust(
                    url
                )
            );

        if (
            !String(html || "")
                .trim()
        ) {
            throw new Error(
                "The game launcher returned an empty document."
            );
        }

        /*
            Same base fix as iframe mode.
        */

        const preparedHTML =
            prepareGameHTML(
                html,
                url
            );

        newWindow.document.open();

        newWindow.document.write(
            preparedHTML
        );

        newWindow.document.close();
    } catch (error) {
        console.error(
            "Failed to open zone in new tab:",
            error
        );

        try {
            newWindow.document.open();

            newWindow.document.write(`
                <!doctype html>
                <html>
                    <head>
                        <meta charset="utf-8">

                        <meta
                            name="viewport"
                            content="width=device-width,initial-scale=1"
                        >

                        <title>
                            GN-Shrub - Load Error
                        </title>
                    </head>

                    <body
                        style="
                            margin:0;
                            padding:24px;
                            background:#07110b;
                            color:#e2e8f0;
                            font-family:system-ui,-apple-system,sans-serif;
                        "
                    >
                        <h2
                            style="
                                color:#4ade80;
                                margin-top:0;
                            "
                        >
                            Could not load this game
                        </h2>

                        <p>
                            ${escapeHTML(
                                error.message
                            )}
                        </p>
                    </body>
                </html>
            `);

            newWindow.document.close();
        } catch {}
    }
}


/* ============================================================
   DOWNLOAD GAME HTML
   ============================================================ */

async function downloadZone() {
    if (!currentZone) {
        showToast(
            "No zone is open."
        );

        return;
    }

    const zoneAtClick =
        currentZone;

    const rawURL =
        String(
            zoneAtClick.url ||
            ""
        )
            .trim();

    if (!rawURL) {
        showToast(
            "This zone does not have a URL."
        );

        return;
    }

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
                cacheBust(
                    url
                )
            );

        const fixedText =
            prepareGameHTML(
                text,
                url
            );

        const blob =
            new Blob(
                [
                    fixedText
                ],
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
                zoneAtClick.name
            )}.html`;

        document.body.appendChild(
            link
        );

        link.click();

        link.remove();

        setTimeout(
            () => {
                URL.revokeObjectURL(
                    objectURL
                );
            },
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


/* ============================================================
   FULLSCREEN
   ============================================================ */

async function fullscreenZone() {
    if (!zoneFrame) {
        showToast(
            "No game frame is open."
        );

        return;
    }

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
            await zoneFrame
                .requestFullscreen();

            return;
        }

        if (
            zoneFrame.webkitRequestFullscreen
        ) {
            zoneFrame.webkitRequestFullscreen();

            return;
        }

        if (
            zoneFrame.webkitEnterFullscreen
        ) {
            zoneFrame.webkitEnterFullscreen();

            return;
        }

        showToast(
            "Fullscreen is not supported by this browser."
        );
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


/* ============================================================
   POPUP
   ============================================================ */

function openPopup(
    title,
    html
) {
    if (
        !popupOverlay ||
        !popupTitle ||
        !popupBody
    ) {
        return;
    }

    popupTitle.textContent =
        String(
            title ||
            ""
        );

    popupBody.innerHTML =
        String(
            html ||
            ""
        );

    popupOverlay.style.display =
        "flex";

    popupOverlay.setAttribute(
        "aria-hidden",
        "false"
    );
}


function closePopup() {
    if (!popupOverlay) {
        return;
    }

    popupOverlay.style.display =
        "none";

    popupOverlay.setAttribute(
        "aria-hidden",
        "true"
    );
}


if (popupOverlay) {
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
}


/* ============================================================
   SETTINGS
   ============================================================ */

if (settingsButton) {
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

                    <p
                        style="
                            margin:1rem 0 0;
                            font-size:.82rem;
                            color:var(--text-muted);
                        "
                    >
                        GN-Shrub stays in dark mode.
                    </p>
                `
            );
        }
    );
}


/* ============================================================
   TAB CLOAK
   ============================================================ */

function cloakName(value) {
    const title =
        String(
            value ||
            ""
        )
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
        String(
            value ||
            ""
        )
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
                <span>
                    Tab Title
                </span>

                <input
                    type="text"
                    id="cloak-title-input"
                    value="${escapeHTML(currentTitle)}"
                    placeholder="Enter a new tab title..."
                >
            </label>

            <label class="popup-field">
                <span>
                    Tab Icon URL
                </span>

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

    const saveButton =
        document.getElementById(
            "save-cloak-button"
        );

    if (!saveButton) {
        return;
    }

    saveButton.addEventListener(
        "click",
        () => {
            const titleInput =
                document.getElementById(
                    "cloak-title-input"
                );

            const iconInput =
                document.getElementById(
                    "cloak-icon-input"
                );

            cloakName(
                titleInput?.value ||
                ""
            );

            cloakIcon(
                iconInput?.value ||
                ""
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
        cloakIcon(
            icon
        );
    }
}


/* ============================================================
   CONTACT
   ============================================================ */

function showContact() {
    openPopup(
        "Contact",
        `
            <h3>
                GN-Shrub
            </h3>

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


/* ============================================================
   DMCA
   ============================================================ */

function loadDMCA() {
    openPopup(
        "DMCA",
        `
            <div class="dmca-content">

                <h3>
                    Content Removal
                </h3>

                <p>
                    GN-Shrub acts as a frontend for game entries
                    loaded from third-party sources.
                </p>

                <p>
                    If you own content displayed through GN-Shrub
                    and want GN-Shrub to stop listing it, contact
                    the maintainer of this site with the game name
                    and proof of ownership.
                </p>

            </div>
        `
    );
}


/* ============================================================
   PRIVACY
   ============================================================ */

function loadPrivacy() {
    openPopup(
        "Privacy",
        `
            <div>

                <h2>
                    GN-Shrub Privacy
                </h2>

                <p>
                    GN-Shrub itself does not require an account.
                </p>

                <p>
                    Tab appearance and imported GN-Shrub settings
                    may be stored locally in your browser.
                </p>

                <p>
                    Games and other resources can be loaded from
                    third-party services. Those services may have
                    their own privacy policies and network logging.
                </p>

                <p>
                    The Export Data button exports GN-Shrub's
                    browser-storage settings. It does not
                    intentionally export browser cookies.
                </p>

            </div>
        `
    );
}


/* ============================================================
   DATA EXPORT
   ============================================================ */

function storageToObject(storage) {
    const result = {};

    for (
        let index = 0;
        index < storage.length;
        index++
    ) {
        const key =
            storage.key(
                index
            );

        if (
            key == null
        ) {
            continue;
        }

        result[key] =
            storage.getItem(
                key
            );
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
            () => {
                URL.revokeObjectURL(
                    url
                );
            },
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


/* ============================================================
   DATA IMPORT
   ============================================================ */

function restoreStorageObject(
    storage,
    value
) {
    if (
        !value ||
        typeof value !==
            "object" ||
        Array.isArray(
            value
        )
    ) {
        return;
    }

    for (
        const [
            key,
            itemValue
        ]
        of Object.entries(
            value
        )
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
                itemValue ??
                ""
            )
        );
    }
}


async function loadData(event) {
    const input =
        event?.target;

    const file =
        input?.files?.[0];

    if (!file) {
        return;
    }

    try {
        const text =
            await file.text();

        const data =
            JSON.parse(
                text
            );

        if (
            !data ||
            typeof data !==
                "object"
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
        if (input) {
            input.value =
                "";
        }
    }
}


/* ============================================================
   DARK MODE
   ============================================================ */

function darkMode() {
    document.body.classList.add(
        "dark-mode"
    );
}


/* ============================================================
   KEYBOARD CONTROLS
   ============================================================ */

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
            popupOverlay &&
            popupOverlay.style.display ===
                "flex"
        ) {
            closePopup();

            return;
        }

        if (
            zoneViewer &&
            !zoneViewer.hidden
        ) {
            closeZone();
        }
    }
);


/* ============================================================
   INITIALIZATION
   ============================================================ */

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


/* ============================================================
   START
   ============================================================ */

initializeGNshrub();
