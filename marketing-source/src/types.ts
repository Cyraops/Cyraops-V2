export interface ServiceItem {
  id: string;
  number: string;
  title: string;
  tagline: string;
  description: string;
  deliverables: string[];
  metrics: string;
}

export interface WorkStep {
  step: string;
  title: string;
  description: string;
  outputs: string[];
  systemState: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface ContactFormData {
  name: string;
  email: string;
  company: string;
  cloudEnvironment: string;
  helpNeeded: string;
  monthlySpend: string;
}

export interface CostCategory {
  id: string;
  name: string;
  currentSpend: number;
  optimizedSpend: number;
  wasteDrivers: string[];
  action: string;
}

export interface DiagnosticFinding {
  id: string;
  node: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  impact: string;
}
