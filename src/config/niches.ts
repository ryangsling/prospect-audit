export const niches = ['salon', 'barber', 'spa', 'roofing', 'epoxy_flooring', 'dentist', 'other'] as const;
export type Niche = typeof niches[number];

export const nichePresets = {
  salon: { inquiriesPerMonth: 120, afterHoursShare: 0.30, closeRate: 0.50, ticketUsd: 70, speedLossRate: 0.05, bookingDropRate: 0.10, medianReviews: 100 },
  barber: { inquiriesPerMonth: 150, afterHoursShare: 0.25, closeRate: 0.60, ticketUsd: 35, speedLossRate: 0.05, bookingDropRate: 0.10, medianReviews: 120 },
  spa: { inquiriesPerMonth: 90, afterHoursShare: 0.30, closeRate: 0.45, ticketUsd: 120, speedLossRate: 0.05, bookingDropRate: 0.10, medianReviews: 80 },
  roofing: { inquiriesPerMonth: 40, afterHoursShare: 0.30, closeRate: 0.20, ticketUsd: 8000, speedLossRate: 0.05, bookingDropRate: 0.05, medianReviews: 50 },
  epoxy_flooring: { inquiriesPerMonth: 30, afterHoursShare: 0.30, closeRate: 0.20, ticketUsd: 3500, speedLossRate: 0.05, bookingDropRate: 0.05, medianReviews: 35 },
  dentist: { inquiriesPerMonth: 80, afterHoursShare: 0.30, closeRate: 0.40, ticketUsd: 250, speedLossRate: 0.05, bookingDropRate: 0.08, medianReviews: 150 },
  other: { inquiriesPerMonth: 60, afterHoursShare: 0.30, closeRate: 0.30, ticketUsd: 200, speedLossRate: 0.05, bookingDropRate: 0.08, medianReviews: 75 },
} satisfies Record<Niche, Record<string, number>>;
