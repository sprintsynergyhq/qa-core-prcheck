import { expect, type Locator, type Page } from '@playwright/test';

export type SortOption = 'az' | 'za' | 'lohi' | 'hilo';

export class InventoryPage {
  readonly page: Page;
  readonly title: Locator;
  readonly sort: Locator;
  readonly names: Locator;
  readonly prices: Locator;
  readonly cartBadge: Locator;
  readonly cartLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.getByTestId('title');
    this.sort = page.getByTestId('product-sort-container');
    this.names = page.getByTestId('inventory-item-name');
    this.prices = page.getByTestId('inventory-item-price');
    this.cartBadge = page.getByTestId('shopping-cart-badge');
    this.cartLink = page.getByTestId('shopping-cart-link');
  }

  async sortBy(value: SortOption) {
    await this.sort.selectOption(value);
    await expect(this.sort).toHaveValue(value);
  }

  // allTextContents() does not auto-wait, so wait for the list to render first.
  async nameValues(): Promise<string[]> {
    await expect(this.names.first()).toBeVisible();
    return this.names.allTextContents();
  }

  async priceValues(): Promise<number[]> {
    await expect(this.prices.first()).toBeVisible();
    const texts = await this.prices.allTextContents();
    return texts.map((text) => {
      const value = Number(text.trim().replace('$', ''));
      // A NaN would make any sort check pass, so fail loudly instead.
      if (Number.isNaN(value)) throw new Error(`Unexpected price text: ${text}`);
      return value;
    });
  }

  async addToCart(slug: string) {
    await this.page.getByTestId(`add-to-cart-${slug}`).click();
  }

  async removeFromCart(slug: string) {
    await this.page.getByTestId(`remove-${slug}`).click();
  }

  // The click returns before the cart page renders, so wait for its URL.
  async openCart() {
    await this.cartLink.click();
    await expect(this.page).toHaveURL(/\/cart\.html$/);
  }
}
