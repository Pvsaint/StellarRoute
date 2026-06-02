import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, test, expect } from "vitest";
import openapiSchema from "../schemas/openapi.json";

describe("OpenAPI schema", () => {
  test("paths should exist", () => {
    expect(openapiSchema.paths).toBeDefined();
    expect(openapiSchema.paths["/api/v1/pairs"]).toBeDefined();
    expect(openapiSchema.paths["/api/v1/orderbook/{base}/{quote}"]).toBeDefined();
    expect(openapiSchema.paths["/api/v1/quote/{base}/{quote}"]).toBeDefined();
  });

  test("components.schemas should exist", () => {
    expect(openapiSchema.components).toBeDefined();
    expect(openapiSchema.components.schemas).toBeDefined();
    expect(openapiSchema.components.schemas.PairsResponse).toBeDefined();
    expect(openapiSchema.components.schemas.OrderbookResponse).toBeDefined();
    expect(openapiSchema.components.schemas.QuoteResponse).toBeDefined();
  });

  test("sample responses should match OpenAPI schemas", () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);

    const compileSchema = (ref: string) =>
      ajv.compile({ $ref: ref, components: openapiSchema.components } as unknown);

    const validatePairs = compileSchema("#/components/schemas/PairsResponse");
    const validateOrderbook = compileSchema("#/components/schemas/OrderbookResponse");
    const validateQuote = compileSchema("#/components/schemas/QuoteResponse");

    const samplePairsResponse = {
      pairs: [
        {
          base: "XLM",
          counter: "USDC",
          base_asset: "native",
          counter_asset:
            "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          offer_count: 42,
          last_updated: "2026-02-23T11:59:00Z",
        },
      ],
      total: 1,
    };

    const sampleOrderbookResponse = {
      base_asset: {
        asset_type: "native",
        asset_code: null,
        asset_issuer: null,
      },
      quote_asset: {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      },
      bids: [
        {
          price: "0.1050000",
          amount: "500.0000000",
          total: "52.5000000",
        },
      ],
      asks: [
        {
          price: "0.1060000",
          amount: "300.0000000",
          total: "31.8000000",
        },
      ],
      timestamp: 1740312000,
    };

    const sampleQuoteResponse = {
      base_asset: {
        asset_type: "native",
        asset_code: null,
        asset_issuer: null,
      },
      quote_asset: {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      },
      amount: "100.0000000",
      price: "0.1055000",
      total: "10.5500000",
      quote_type: "sell",
      path: [
        {
          from_asset: {
            asset_type: "native",
            asset_code: null,
            asset_issuer: null,
          },
          to_asset: {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer:
              "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
          },
          price: "0.1055000",
          source: "sdex",
        },
      ],
      timestamp: 1740312000,
    };

    expect(validatePairs(samplePairsResponse)).toBe(true);
    expect(validatePairs.errors).toBeNull();

    expect(validateOrderbook(sampleOrderbookResponse)).toBe(true);
    expect(validateOrderbook.errors).toBeNull();

    expect(validateQuote(sampleQuoteResponse)).toBe(true);
    expect(validateQuote.errors).toBeNull();
  });
});