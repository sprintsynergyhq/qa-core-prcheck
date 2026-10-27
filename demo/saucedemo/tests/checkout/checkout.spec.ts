import { expect, test } from '@playwright/test';
import { USERS } from '../../fixtures/users';
import { CartPage } from '../../pages/cart-page';
import { CheckoutPage } from '../../pages/checkout-page';
import { InventoryPage } from '../../pages/inventory-page';
import { LoginPage } from '../../pages/login-page';

test.describe('checkout', { tag: '@checkout' }, () => {
  test.beforeEach(async ({ page }) => {
    const inventoryPage = new InventoryPage(page);

    await new LoginPage(page).loginAs(USERS.standard);
    await inventoryPage.addToCart('sauce-labs-backpack');
    await inventoryPage.openCart();
    await new CartPage(page).checkout();
  });

  test('completes an order', async ({ page }) => {
    const checkoutPage = new CheckoutPage(page);

    await checkoutPage.fillInfo('Test', 'User', '12345');
    await checkoutPage.continue();
    await checkoutPage.finish();

    await expect(page).toHaveURL(/\/checkout-complete\.html$/);
    await expect(checkoutPage.completeHeader).toHaveText('Thank you for your order!');
  });

  test('requires a first name', async ({ page }) => {
    const checkoutPage = new CheckoutPage(page);

    await checkoutPage.fillInfo('', 'User', '12345');
    await checkoutPage.continue();

    await expect(checkoutPage.error).toHaveText('Error: First Name is required');
  });
});
