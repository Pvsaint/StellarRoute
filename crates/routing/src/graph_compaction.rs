//! Incremental liquidity graph compaction.
//!
//! The pathfinder accepts a flat `Vec<LiquidityEdge>`, while the indexer updates
//! liquidity one venue at a time. `RouteGraphCompactor` keeps that mutable view
//! keyed by venue edge so callers can upsert only changed edges, prune weak
//! liquidity, and cap redundant parallel venues without rebuilding the graph.

use crate::pathfinder::LiquidityEdge;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::mem::size_of;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct EdgeKey {
    pub from: String,
    pub to: String,
    pub venue_type: String,
    pub venue_ref: String,
}

impl EdgeKey {
    pub fn from_edge(edge: &LiquidityEdge) -> Self {
        Self {
            from: edge.from.clone(),
            to: edge.to.clone(),
            venue_type: edge.venue_type.clone(),
            venue_ref: edge.venue_ref.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GraphCompactionConfig {
    /// Drops edges below this liquidity floor before pathfinding.
    pub min_liquidity: i128,
    /// Keeps at most this many venues for each `(from, to)` pair.
    pub max_edges_per_pair: usize,
    /// Optional anomaly ceiling; edges above it are pruned.
    pub max_anomaly_score: Option<f64>,
}

impl Default for GraphCompactionConfig {
    fn default() -> Self {
        Self {
            min_liquidity: 1_000_000,
            max_edges_per_pair: 4,
            max_anomaly_score: Some(0.95),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct CompactionReport {
    pub input_edges: usize,
    pub stored_edges_before: usize,
    pub stored_edges_after: usize,
    pub output_edges: usize,
    pub inserted_or_updated: usize,
    pub removed_by_key: usize,
    pub pruned_low_liquidity: usize,
    pub pruned_anomalies: usize,
    pub pruned_pair_overflow: usize,
    pub estimated_bytes_before: usize,
    pub estimated_bytes_after: usize,
}

impl CompactionReport {
    pub fn reduction_percent(&self) -> f64 {
        if self.estimated_bytes_before == 0 {
            return 0.0;
        }

        let reduced = self
            .estimated_bytes_before
            .saturating_sub(self.estimated_bytes_after);
        (reduced as f64 / self.estimated_bytes_before as f64) * 100.0
    }
}

#[derive(Clone, Debug, Default)]
pub struct GraphUpdate {
    pub upserts: Vec<LiquidityEdge>,
    pub removals: Vec<EdgeKey>,
}

impl GraphUpdate {
    pub fn from_edges(upserts: Vec<LiquidityEdge>) -> Self {
        Self {
            upserts,
            removals: Vec::new(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct CompactedGraph {
    pub edges: Vec<LiquidityEdge>,
    pub report: CompactionReport,
}

#[derive(Clone, Debug)]
pub struct RouteGraphCompactor {
    config: GraphCompactionConfig,
    edges: HashMap<EdgeKey, LiquidityEdge>,
}

impl RouteGraphCompactor {
    pub fn new(config: GraphCompactionConfig) -> Self {
        Self {
            config,
            edges: HashMap::new(),
        }
    }

    pub fn from_edges(config: GraphCompactionConfig, edges: Vec<LiquidityEdge>) -> CompactedGraph {
        let mut compactor = Self::new(config);
        compactor.apply_update(GraphUpdate::from_edges(edges))
    }

    pub fn len(&self) -> usize {
        self.edges.len()
    }

    pub fn is_empty(&self) -> bool {
        self.edges.is_empty()
    }

    pub fn apply_update(&mut self, update: GraphUpdate) -> CompactedGraph {
        let stored_edges_before = self.edges.len();
        let mut report = CompactionReport {
            input_edges: update.upserts.len(),
            stored_edges_before,
            estimated_bytes_before: estimate_edge_bytes(stored_edges_before),
            ..CompactionReport::default()
        };

        for key in update.removals {
            if self.edges.remove(&key).is_some() {
                report.removed_by_key += 1;
            }
        }

        for edge in update.upserts {
            self.edges.insert(EdgeKey::from_edge(&edge), edge);
            report.inserted_or_updated += 1;
        }

        report.estimated_bytes_before = estimate_edge_bytes(self.edges.len());
        let (edges, low, anomalies, overflow) = compact_snapshot(&self.edges, &self.config);
        let retained: HashSet<EdgeKey> = edges.iter().map(EdgeKey::from_edge).collect();
        self.edges.retain(|key, _| retained.contains(key));

        report.pruned_low_liquidity = low;
        report.pruned_anomalies = anomalies;
        report.pruned_pair_overflow = overflow;
        report.stored_edges_after = self.edges.len();
        report.output_edges = edges.len();
        report.estimated_bytes_after = estimate_edge_bytes(edges.len());

        CompactedGraph { edges, report }
    }

    pub fn compacted_edges(&self) -> Vec<LiquidityEdge> {
        compact_snapshot(&self.edges, &self.config).0
    }
}

fn compact_snapshot(
    edges: &HashMap<EdgeKey, LiquidityEdge>,
    config: &GraphCompactionConfig,
) -> (Vec<LiquidityEdge>, usize, usize, usize) {
    let mut by_pair: HashMap<(String, String), Vec<LiquidityEdge>> = HashMap::new();
    let mut pruned_low_liquidity = 0;
    let mut pruned_anomalies = 0;

    for edge in edges.values() {
        if edge.liquidity < config.min_liquidity {
            pruned_low_liquidity += 1;
            continue;
        }

        if config
            .max_anomaly_score
            .is_some_and(|max_score| edge.anomaly_score > max_score)
        {
            pruned_anomalies += 1;
            continue;
        }

        by_pair
            .entry((edge.from.clone(), edge.to.clone()))
            .or_default()
            .push(edge.clone());
    }

    let mut output = Vec::new();
    let mut pruned_pair_overflow = 0;

    for mut pair_edges in by_pair.into_values() {
        pair_edges.sort_by(|a, b| {
            b.liquidity
                .cmp(&a.liquidity)
                .then_with(|| a.fee_bps.cmp(&b.fee_bps))
                .then_with(|| a.venue_ref.cmp(&b.venue_ref))
        });

        if pair_edges.len() > config.max_edges_per_pair {
            pruned_pair_overflow += pair_edges.len() - config.max_edges_per_pair;
            pair_edges.truncate(config.max_edges_per_pair);
        }

        output.extend(pair_edges);
    }

    output.sort_by(|a, b| {
        a.from
            .cmp(&b.from)
            .then_with(|| a.to.cmp(&b.to))
            .then_with(|| a.venue_type.cmp(&b.venue_type))
            .then_with(|| a.venue_ref.cmp(&b.venue_ref))
    });

    (
        output,
        pruned_low_liquidity,
        pruned_anomalies,
        pruned_pair_overflow,
    )
}

fn estimate_edge_bytes(edge_count: usize) -> usize {
    edge_count * size_of::<LiquidityEdge>()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edge(from: &str, to: &str, venue_ref: &str, liquidity: i128) -> LiquidityEdge {
        LiquidityEdge {
            from: from.to_string(),
            to: to.to_string(),
            venue_type: "amm".to_string(),
            venue_ref: venue_ref.to_string(),
            liquidity,
            price: 1.0,
            fee_bps: 30,
            anomaly_score: 0.0,
            anomaly_reasons: Vec::new(),
        }
    }

    #[test]
    fn update_replaces_edge_without_growing_snapshot() {
        let mut compactor = RouteGraphCompactor::new(GraphCompactionConfig {
            min_liquidity: 0,
            ..GraphCompactionConfig::default()
        });
        compactor.apply_update(GraphUpdate::from_edges(vec![edge("XLM", "USDC", "pool-a", 10)]));

        let result = compactor.apply_update(GraphUpdate::from_edges(vec![edge(
            "XLM", "USDC", "pool-a", 20,
        )]));

        assert_eq!(result.edges.len(), 1);
        assert_eq!(result.edges[0].liquidity, 20);
        assert_eq!(compactor.len(), 1);
    }

    #[test]
    fn low_liquidity_and_pair_overflow_are_pruned() {
        let config = GraphCompactionConfig {
            min_liquidity: 100,
            max_edges_per_pair: 2,
            max_anomaly_score: None,
        };
        let mut compactor = RouteGraphCompactor::new(config);

        let result = compactor.apply_update(GraphUpdate::from_edges(vec![
            edge("XLM", "USDC", "low", 10),
            edge("XLM", "USDC", "best", 500),
            edge("XLM", "USDC", "second", 400),
            edge("XLM", "USDC", "third", 300),
        ]));

        let refs: Vec<_> = result.edges.iter().map(|edge| edge.venue_ref.as_str()).collect();
        assert_eq!(refs, vec!["best", "second"]);
        assert_eq!(result.report.pruned_low_liquidity, 1);
        assert_eq!(result.report.pruned_pair_overflow, 1);
    }
}
