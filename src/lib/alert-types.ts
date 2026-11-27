import type { Timestamp } from 'firebase/firestore';

export type AlertRecord = {
  demo_source_id?: string; demo_original_received_at?: Timestamp;
  id: string; received_at?: Timestamp; device_id?: string;
  class_id?: number; action?: string; src_ip?: string; dst_ip?: string;
  src_port?: number; dst_port?: number; protocol?: number;
  event_id?: string; boot_id?: string; timestamp_ms?: number;
  model_version?: number; ingress_port?: number; tree_error?: number;
  tree_steps?: number; latency_cycles?: number;
};
