import { expect, test } from '@playwright/test';
import { USERS } from '../../fixtures/users';
import { CartPage } from '../../pages/cart-page';
import { InventoryPage } from '../../pages/inventory-page';
import { LoginPage } from '../../pages/login-page';

test.describe('cart', { tag: '@cart' }, () => {
  test.beforeEach(async ({ page }) => {
    await new LoginPage(page).loginAs(USERS.standard);
  });

  test('adds a product to the cart', async ({ page }) => {
    const inventoryPage = new InventoryPage(page);
    const cartPage = new CartPage(page);

    await inventoryPage.addToCart('sauce-labs-backpack');
    await expect(inventoryPage.cartBadge).toHaveText('1');

    await inventoryPage.openCart();
    await cartPage.waitForLoaded();
    await expect(cartPage.itemNames).toContainText('Sauce Labs Backpack');
  });

  test('removes a product from the cart', async ({ page }) => {
    const inventoryPage = new InventoryPage(page);

    await inventoryPage.addToCart('sauce-labs-backpack');
    await inventoryPage.removeFromCart('sauce-labs-backpack');

    await expect(inventoryPage.cartBadge).toHaveCount(0);
  });
});
