import type { DeliveryModeName, ProductTypeName } from "@asap/shared";

/** Serialisable product card payload (safe to pass to client components). Money in kopecks. */
export interface ProductCardData {
  id: string;
  slug: string;
  title: string;
  coverImage: string | null;
  price: number;
  oldPrice: number | null;
  platform: string | null;
  region: string | null;
  type: ProductTypeName;
  deliveryMode: DeliveryModeName;
  ratingAvg: number;
  ratingCount: number;
  salesCount: number;
  hasVariants: boolean;
  inStock: boolean;
  sellerName: string | null;
  sellerSlug: string | null;
  isFavorite: boolean;
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface CatalogFacets {
  platforms: FacetOption[];
  regions: FacetOption[];
  types: FacetOption[];
  /** kopecks */
  priceMin: number;
  priceMax: number;
}

export interface CatalogResult {
  items: ProductCardData[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
