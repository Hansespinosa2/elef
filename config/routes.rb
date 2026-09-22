Rails.application.routes.draw do
  root "library#index"

  resources :snippets, except: :show

  resources :presentations do
    collection do
      post :load_samples
      post :start
      post :preview
    end
    member do
      get :present
      post :publish
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
    end
    member do
      match :preview, via: %i[get post]
      patch :rename
    end
  end

  get "up" => "rails/health#show", as: :rails_health_check
end
