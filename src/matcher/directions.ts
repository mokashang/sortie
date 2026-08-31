// 12 方向的规范目录(spec §1.2)。label + 描述会喂给匹配 prompt,帮助模型判断契合度。
// slug 与 profile.yaml 的 directions key 一致。
export const DIRECTIONS: Record<string, { label: string; blurb: string }> = {
  swe_general: { label: "SWE (General)", blurb: "General software engineering: full-stack, product, platform." },
  swe_backend: { label: "SWE (Backend/Distributed)", blurb: "Backend services, distributed systems, APIs, databases." },
  ai_infra: { label: "AI Infra / ML Systems", blurb: "Training/inference platforms, GPU scheduling, distributed ML systems." },
  mle: { label: "MLE / Applied ML", blurb: "Applied machine learning: recommendation, search, ranking, model serving." },
  quant: { label: "Quant Dev / Research", blurb: "Quantitative developer or researcher at trading firms; low-latency, probability." },
  embedded: { label: "Embedded / Firmware", blurb: "Embedded software, firmware, real-time systems, hardware-software interface." },
  systems_perf: { label: "Systems / Performance", blurb: "Kernel, compilers, low-latency, performance engineering, systems programming." },
  robotics: { label: "Robotics / Autonomy SW", blurb: "Robotics software, autonomy, perception, motion planning." },
  sre_infra: { label: "SRE / Infra / DevOps", blurb: "Site reliability, cloud infrastructure, DevOps, observability." },
  data: { label: "Data Science / DE", blurb: "Data science, data engineering, analytics pipelines." },
  security: { label: "Security Engineering", blurb: "Application/infra security, detection, secure systems." },
  gpu_cuda: { label: "GPU / CUDA", blurb: "GPU kernel optimization, CUDA, performance for ML/HPC workloads." },
};

export function directionLabel(slug: string): string {
  return DIRECTIONS[slug]?.label ?? slug;
}

export function isKnownDirection(slug: string): boolean {
  return slug in DIRECTIONS;
}
