import type { ReactNode } from "react";

export type PricingPlanKey = "free" | "team" | "fleet";

interface PricingPlan {
  key: PricingPlanKey;
  name: string;
  monthlyPrice: number;
  privateRepositoryLimit: number;
}

export const PRICING_PLANS = [
  {
    key: "free",
    name: "Free",
    monthlyPrice: 0,
    privateRepositoryLimit: 5,
  },
  {
    key: "team",
    name: "Team",
    monthlyPrice: 29,
    privateRepositoryLimit: 25,
  },
  {
    key: "fleet",
    name: "Fleet",
    monthlyPrice: 79,
    privateRepositoryLimit: 100,
  },
] as const satisfies readonly PricingPlan[];

interface PricingPlanCardsProps {
  actions?: Partial<Record<PricingPlanKey, ReactNode>>;
}

export function PricingPlanCards({ actions = {} }: PricingPlanCardsProps) {
  return (
    <div className="pricing-grid">
      {PRICING_PLANS.map((plan) => (
        <article className="pricing-card" key={plan.key}>
          <h3>{plan.name}</h3>
          <p className="price">
            <data value={plan.monthlyPrice}>${plan.monthlyPrice}</data> <span>/ month</span>
          </p>
          <p className="plan-capacity">
            Up to <strong>{plan.privateRepositoryLimit} selected private repositories</strong>
          </p>
          {actions[plan.key] === undefined ? null : (
            <div className="plan-action">{actions[plan.key]}</div>
          )}
        </article>
      ))}
    </div>
  );
}
