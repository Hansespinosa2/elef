Rails.application.routes.draw do
  root "library#index"

  resource :settings, only: %i[show update], controller: "workspace_settings"
  get "search", to: "library#search", as: :search

  resources :snippets, except: :show
  resources :math_shortcuts, except: :show

  resources :presentations do
    collection do
      post :load_samples
      post :start
      post :preview
      post :import
    end
    member do
      get :present
      get :print
      match :pptx, via: %i[get post], defaults: { format: :json }
      post :upload_asset, path: "assets"
      get "assets/:digest", action: :media_asset, as: :media_asset
      get "pptx_assets/:digest", action: :pptx_asset, as: :pptx_asset
      post :publish
      post :restore
      get :history
      get :export
      match :preview, via: %i[get post]
      patch :rename
      post :fork
    end
  end

  resources :documents do
    collection do
      post :load_samples
      post :start
      post :preview
      post :import
    end
    member do
      post :restore
      get :history
      get :export
      match :preview, via: %i[get post]
      patch :rename
    end
  end

  get "up" => "rails/health#show", as: :rails_health_check
end
