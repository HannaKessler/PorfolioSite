export const typeDefs = /* GraphQL */ `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])

  enum EventType { PRODUCT_VIEW SEARCH ADD_TO_CART }
  enum ConsentState { UNKNOWN GRANTED DENIED }
  enum RowSource { PROFILE DEFAULT }

  type Query {
    viewerProfile: ViewerProfile!
    recommendedForYou(limit: Int = 12): ProductRow!
  }

  type Mutation {
    trackEvent(input: TrackEventInput!): ViewerProfile!
    syncSearchHistory(queries: [String!]!): ViewerProfile!
    setConsent(granted: Boolean!): ViewerProfile!
    setDemoFaults(outage: Boolean, slow: Boolean, killSwitch: Boolean): Boolean!
    recordExposure(productIds: [ID!]!, requestId: ID!): Boolean!
  }

  type ViewerProfile @key(fields: "id") {
    id: ID!
    consent: ConsentState!
    traits: ProfileTraits!
    segments: [Segment!]!
    eventCount: Int!
  }

  type ProfileTraits {
    preferredCategories: [CategoryAffinity!]!
    priceMin: Float
    priceMax: Float
    recentSearches: [String!]!
  }

  type CategoryAffinity {
    name: String!
    slug: String!
    views: Int!
    searches: Int!
    carts: Int!
  }

  type Segment { id: ID! label: String! }

  type ProductRow {
    title: String!
    source: RowSource!
    reason: String
    productIds: [ID!]!
  }

  input TrackEventInput {
    type: EventType!
    productId: ID
    query: String
  }
`;
