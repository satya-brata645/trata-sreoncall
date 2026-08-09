---
name: monitor-kafka-consumergroup-recovery
description: Monitor the recovery of a Kafka consumergroup after a metric decrease.
origin: learned
learned_from: inc_2b29fecfc51b
evidence_refs: [ev_2cc417199a8c, ev_90eb38e9a87e]
times_applied: 0
---

When a Kafka consumergroup's critical metric significantly decreases following a previously noted high point, this may signal recovery. Start by observing for consistency in the improved metric level. Investigate any changes in workload or configuration that could influence this improvement, ensuring they are intentional and beneficial. Monitor for a sustained period to confirm that the consumergroup's performance remains stable and aligns with expected operational parameters.
