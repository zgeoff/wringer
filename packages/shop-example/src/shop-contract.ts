import { oc } from '@orpc/contract';
import { z } from 'zod';

const orderSchema = z.strictObject({ id: z.number().int(), item: z.string() });

export type Order = z.infer<typeof orderSchema>;

export const ordersSchema = z.array(orderSchema);
export const placedOrderSchema = orderSchema.pick({ id: true });

export type PlacedOrder = z.infer<typeof placedOrderSchema>;

// The example shop's orders API, shared by the app that serves it and the journey that calls it.
export const shopContract = {
  orders: {
    list: oc.route({ method: 'GET', path: '/api/orders' }).output(ordersSchema),
    place: oc.route({ method: 'POST', path: '/api/orders' }).output(placedOrderSchema),
  },
};
