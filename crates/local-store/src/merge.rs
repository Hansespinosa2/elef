//! Deterministic three-way line merge.

use serde::Deserialize;
use serde::Serialize;

/// Outcome of a deterministic three-way line merge of local edits against an
/// external disk change. `Overlap` and `Suspicious` never write: the caller
/// snapshots first and routes to the conflict/recovery path instead.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MergeOutcome {
    Merged(String),
    Overlap,
    Suspicious,
}

/// Largest trimmed middle (in lines, per side) eligible for exact diffing.
/// Larger simultaneous rewrites take the safe conflict path instead of an
/// expensive or surprising automatic merge.
pub(crate) const MERGE_DIFF_LINE_CAP: usize = 400;

/// Suspicious-change local-length floor from the Phase 02 contract, in characters.
pub(crate) const SUSPICIOUS_MIN_LOCAL_CHARS: usize = 200;

pub(crate) fn is_suspicious_external_change(local: &str, external: &str) -> bool {
    if external.is_empty() {
        return !local.is_empty();
    }
    let local_chars = local.chars().count();
    if local_chars < SUSPICIOUS_MIN_LOCAL_CHARS {
        return false;
    }
    external.chars().count() * 2 < local_chars
}

pub(crate) fn split_lines(text: &str) -> Vec<&str> {
    text.split_inclusive('\n').collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Hunk<'a> {
    pub(crate) old_start: usize,
    pub(crate) old_end: usize,
    pub(crate) replacement: Vec<&'a str>,
}

pub(crate) fn change_hunks<'a>(old: &[&'a str], new: &[&'a str]) -> Option<Vec<Hunk<'a>>> {
    let mut prefix = 0;
    while prefix < old.len() && prefix < new.len() && old[prefix] == new[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < old.len() - prefix
        && suffix < new.len() - prefix
        && old[old.len() - 1 - suffix] == new[new.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let mid_old = &old[prefix..old.len() - suffix];
    let mid_new = &new[prefix..new.len() - suffix];
    if mid_old == mid_new {
        return Some(Vec::new());
    }
    if mid_old.len() > MERGE_DIFF_LINE_CAP || mid_new.len() > MERGE_DIFF_LINE_CAP {
        return None;
    }
    let (m, n) = (mid_old.len(), mid_new.len());
    let mut table = vec![0u32; (m + 1) * (n + 1)];
    for i in 0..m {
        for j in 0..n {
            table[(i + 1) * (n + 1) + (j + 1)] = if mid_old[i] == mid_new[j] {
                table[i * (n + 1) + j] + 1
            } else {
                table[i * (n + 1) + (j + 1)].max(table[(i + 1) * (n + 1) + j])
            };
        }
    }
    #[derive(PartialEq, Eq)]
    enum Op {
        Equal,
        Del,
        Ins,
    }
    let (mut i, mut j) = (m, n);
    let mut ops = Vec::new();
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && mid_old[i - 1] == mid_new[j - 1] {
            ops.push(Op::Equal);
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || table[i * (n + 1) + (j - 1)] >= table[(i - 1) * (n + 1) + j])
        {
            ops.push(Op::Ins);
            j -= 1;
        } else {
            ops.push(Op::Del);
            i -= 1;
        }
    }
    ops.reverse();
    let mut hunks = Vec::new();
    let (mut oi, mut ni, mut k) = (0, 0, 0);
    while k < ops.len() {
        if ops[k] == Op::Equal {
            oi += 1;
            ni += 1;
            k += 1;
            continue;
        }
        let start = oi;
        let mut replacement = Vec::new();
        while k < ops.len() && ops[k] != Op::Equal {
            match ops[k] {
                Op::Del => oi += 1,
                Op::Ins => {
                    replacement.push(mid_new[ni]);
                    ni += 1;
                }
                Op::Equal => unreachable!(),
            }
            k += 1;
        }
        hunks.push(Hunk {
            old_start: prefix + start,
            old_end: prefix + oi,
            replacement,
        });
    }
    Some(hunks)
}

pub(crate) fn merge_sources(ancestor: &str, local: &str, external: &str) -> MergeOutcome {
    if local == external {
        return MergeOutcome::Merged(local.to_owned());
    }
    if external == ancestor {
        return MergeOutcome::Merged(local.to_owned());
    }
    if is_suspicious_external_change(local, external) {
        return MergeOutcome::Suspicious;
    }
    if local == ancestor {
        return MergeOutcome::Merged(external.to_owned());
    }
    let ancestor_lines = split_lines(ancestor);
    let local_hunks = match change_hunks(&ancestor_lines, &split_lines(local)) {
        Some(hunks) => hunks,
        None => return MergeOutcome::Overlap,
    };
    let external_hunks = match change_hunks(&ancestor_lines, &split_lines(external)) {
        Some(hunks) => hunks,
        None => return MergeOutcome::Overlap,
    };
    let mut merged: Vec<&str> = Vec::new();
    let mut pos = 0;
    let (mut li, mut ei) = (0, 0);
    while li < local_hunks.len() || ei < external_hunks.len() {
        let take_local = match (local_hunks.get(li), external_hunks.get(ei)) {
            (Some(local), Some(external)) => local.old_start <= external.old_start,
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => unreachable!(),
        };
        if let (Some(local), Some(external)) = (local_hunks.get(li), external_hunks.get(ei))
            && local.old_start == external.old_start
            && local.old_end == external.old_end
            && local.replacement == external.replacement
        {
            if local.old_start < pos {
                return MergeOutcome::Overlap;
            }
            merged.extend_from_slice(&ancestor_lines[pos..local.old_start]);
            merged.extend_from_slice(&local.replacement);
            pos = pos.max(local.old_end);
            li += 1;
            ei += 1;
            continue;
        }
        let hunk = if take_local {
            &local_hunks[li]
        } else {
            &external_hunks[ei]
        };
        if hunk.old_start < pos {
            return MergeOutcome::Overlap;
        }
        if hunk.old_start == hunk.old_end {
            let other = if take_local {
                external_hunks.get(ei)
            } else {
                local_hunks.get(li)
            };
            if let Some(other) = other {
                let clashes = if other.old_start == other.old_end {
                    other.old_start == hunk.old_start && other.replacement != hunk.replacement
                } else {
                    other.old_start <= hunk.old_start && hunk.old_start < other.old_end
                };
                if clashes {
                    return MergeOutcome::Overlap;
                }
            }
            merged.extend_from_slice(&ancestor_lines[pos..hunk.old_start]);
            merged.extend_from_slice(&hunk.replacement);
            pos = hunk.old_start;
        } else {
            merged.extend_from_slice(&ancestor_lines[pos..hunk.old_start]);
            merged.extend_from_slice(&hunk.replacement);
            pos = hunk.old_end;
        }
        if take_local {
            li += 1;
        } else {
            ei += 1;
        }
    }
    merged.extend_from_slice(&ancestor_lines[pos..]);
    MergeOutcome::Merged(merged.concat())
}

#[cfg(test)]
mod tests {
    use crate::merge::{MergeOutcome, is_suspicious_external_change, merge_sources};

    #[test]
    fn suspicious_change_flags_empty_external_with_local_text() {
        assert!(is_suspicious_external_change("hello", ""));
        assert!(is_suspicious_external_change("x", ""));
        assert!(!is_suspicious_external_change("", ""));
        assert!(!is_suspicious_external_change("", "hello"));
    }

    #[test]
    fn suspicious_change_thresholds_use_character_counts_at_exact_boundaries() {
        let local_199: String = "a".repeat(199);
        let local_200: String = "a".repeat(200);
        let local_201: String = "a".repeat(201);
        // Below the 200-character floor: never suspicious by ratio.
        assert!(!is_suspicious_external_change(&local_199, &"a".repeat(10)));
        assert!(!is_suspicious_external_change(&local_199, "a"));
        // Exactly half is not "less than half".
        assert!(!is_suspicious_external_change(&local_200, &"a".repeat(100)));
        // Just below half is suspicious.
        assert!(is_suspicious_external_change(&local_200, &"a".repeat(99)));
        assert!(is_suspicious_external_change(&local_201, &"a".repeat(100)));
        // Just above half is benign.
        assert!(!is_suspicious_external_change(&local_200, &"a".repeat(101)));
        // Characters, not bytes: 200 emoji vs 99 emoji still trips.
        assert!(is_suspicious_external_change(
            &"é".repeat(200),
            &"é".repeat(99)
        ));
        assert!(!is_suspicious_external_change(
            &"é".repeat(200),
            &"é".repeat(100)
        ));
    }

    #[test]
    fn merge_prefers_fast_paths_before_diffing() {
        assert_eq!(
            merge_sources("a\n", "b\n", "b\n"),
            MergeOutcome::Merged("b\n".into())
        );
        assert_eq!(
            merge_sources("a\n", "b\n", "a\n"),
            MergeOutcome::Merged("b\n".into())
        );
        assert_eq!(
            merge_sources("a\n", "a\n", "b\n"),
            MergeOutcome::Merged("b\n".into())
        );
    }

    #[test]
    fn merge_combines_non_overlapping_edits_from_both_sides() {
        let ancestor = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n";
        let local = "one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n";
        let external = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nNINE\nten\n";
        assert_eq!(
            merge_sources(ancestor, local, external),
            MergeOutcome::Merged(
                "one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\nNINE\nten\n".into()
            )
        );
    }

    #[test]
    fn merge_combines_append_and_prepend() {
        let ancestor = "middle\n";
        let local = "middle\nlocal-tail\n";
        let external = "external-head\nmiddle\n";
        assert_eq!(
            merge_sources(ancestor, local, external),
            MergeOutcome::Merged("external-head\nmiddle\nlocal-tail\n".into())
        );
    }

    #[test]
    fn merge_applies_identical_edits_once() {
        let ancestor = "a\nb\nc\n";
        let edited = "a\nB\nc\n";
        assert_eq!(
            merge_sources(ancestor, edited, edited),
            MergeOutcome::Merged(edited.into())
        );
        let inserted = "a\nx\nb\nc\n";
        assert_eq!(
            merge_sources(ancestor, inserted, inserted),
            MergeOutcome::Merged(inserted.into())
        );
    }

    #[test]
    fn merge_reports_overlap_for_same_line_edits() {
        let ancestor = "a\nb\nc\n";
        assert_eq!(
            merge_sources(ancestor, "a\nB\nc\n", "a\nX\nc\n"),
            MergeOutcome::Overlap
        );
        assert_eq!(
            merge_sources(ancestor, "a\nx\nb\nc\n", "a\ny\nb\nc\n"),
            MergeOutcome::Overlap
        );
    }

    #[test]
    fn merge_preserves_crlf_line_endings() {
        let ancestor = "a\r\nb\r\nc\r\n";
        let local = "a\r\nB\r\nc\r\n";
        let external = "a\r\nb\r\nC\r\n";
        assert_eq!(
            merge_sources(ancestor, local, external),
            MergeOutcome::Merged("a\r\nB\r\nC\r\n".into())
        );
    }

    #[test]
    fn merge_refuses_suspicious_external_change_before_diffing() {
        let ancestor: String = "a".repeat(200);
        let local = format!("{ancestor}\nlocal keeps working");
        assert_eq!(
            merge_sources(&ancestor, &local, ""),
            MergeOutcome::Suspicious
        );
        assert_eq!(
            merge_sources(&ancestor, &local, &"a".repeat(50)),
            MergeOutcome::Suspicious
        );
    }

    #[test]
    fn merge_accepts_unchanged_external_despite_long_local_text() {
        // No external change means nothing suspicious, however long local grew.
        let ancestor = "short\n";
        let local = format!("{}\n{}", "x".repeat(300), "more\n".repeat(10));
        assert_eq!(
            merge_sources(ancestor, &local, ancestor),
            MergeOutcome::Merged(local.clone())
        );
    }

    #[test]
    fn merge_falls_back_to_overlap_past_the_diff_cap() {
        let ancestor = (0..500).map(|i| format!("line {i}\n")).collect::<String>();
        let local = ancestor.replacen("line 10\n", "LOCAL\n", 1);
        // External rewrites the whole body so the trimmed middle exceeds the cap.
        let external = (0..500).map(|i| format!("other {i}\n")).collect::<String>();
        assert_eq!(
            merge_sources(&ancestor, &local, &external),
            MergeOutcome::Overlap
        );
    }

    #[test]
    fn merge_is_deterministic_for_fixed_vectors() {
        let ancestor = "alpha\nbeta\ngamma\ndelta\n";
        let local = "alpha\nBETA\ngamma\ndelta\nepsilon\n";
        let external = "alpha\nbeta\nGAMMA\ndelta\n";
        let first = merge_sources(ancestor, local, external);
        let second = merge_sources(ancestor, local, external);
        assert_eq!(first, second);
        assert_eq!(
            first,
            MergeOutcome::Merged("alpha\nBETA\nGAMMA\ndelta\nepsilon\n".into())
        );
    }
}
