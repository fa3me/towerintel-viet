/**
 * TowerIntel Vietnam — country & operator branding (single source of truth).
 */

/** Mobile network operators (Vietnam market). */
export const MNOS = ['Viettel', 'Vinaphone', 'Mobifone', 'Vietnamobile'];

/** Short labels for compact chips / UI */
export const MNO_SHORT = {
    Viettel: 'Vt',
    Vinaphone: 'Vp',
    Mobifone: 'Mb',
    Vietnamobile: 'Vm'
};

/** Deck / map colors [r,g,b] */
export const MNO_RGB = {
    Viettel: [0, 229, 255],
    Vinaphone: [0, 200, 83],
    Mobifone: [255, 145, 0],
    Vietnamobile: [171, 71, 188]
};

/** Hex for CSS */
export const MNO_HEX = {
    Viettel: '#00e5ff',
    Vinaphone: '#00c853',
    Mobifone: '#ff9100',
    Vietnamobile: '#ab47bc'
};

export const APP_TITLE = 'TowerIntel Vietnam';
export const APP_SHORT = 'TowerIntel VN';
export const COUNTRY_CODE_ISO2 = 'VN';

/** Default map view — Vietnam extent (rough center). */
export const INITIAL_MAP_VIEW = {
    longitude: 105.85,
    latitude: 16.0,
    zoom: 5.8,
    pitch: 0,
    bearing: 0
};

/** Vietnam approximate bounding box for synthetic population grid [west, south, east, north] */
export const VIETNAM_BOUNDS = { west: 102.14, south: 8.38, east: 109.46, north: 23.39 };

/** World Bank indicator: total population */
export const WB_POP_INDICATOR = 'SP.POP.TOTL';
export const WB_COUNTRY_ISO3 = 'VNM';
