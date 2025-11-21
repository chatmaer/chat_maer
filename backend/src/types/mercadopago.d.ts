// Type declarations for mercadopago module
declare module "mercadopago" {
  interface MercadoPagoConfig {
    setAccessToken(token: string): void;
  }

  interface PaymentData {
    payment_method_id: string;
    description: string;
    transaction_amount: number;
    payer: {
      email: string;
      first_name: string;
      last_name: string;
      identification: {
        type: string;
        number: string;
      };
    };
    external_reference?: string;
  }

  interface PaymentResponse {
    id: number;
    status: string;
    status_detail: string;
    point_of_interaction?: {
      transaction_data?: {
        qr_code?: string;
        qr_code_base64?: string;
      };
    };
  }

  interface PaymentCreateResponse {
    response: PaymentResponse;
  }

  interface PaymentFindResponse {
    response: PaymentResponse;
  }

  interface Payment {
    create(data: PaymentData): Promise<PaymentCreateResponse>;
    findById(id: number): Promise<PaymentFindResponse>;
  }

  interface MercadoPago {
    configurations: MercadoPagoConfig;
    payment: Payment;
  }

  const mercadopago: MercadoPago;
  export default mercadopago;
}

