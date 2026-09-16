Rails.application.routes.draw do
  root "presentations#index"

  resources :snippets, except: :show

  resources :presentations do
    collection do
      post :load_samples
      post :start
    end
    member do
      get :present
      match :preview, via: %i[get post]
      patch :rename
      post :fork
    end
  end

  resources :documents do
    collection { post :start }
    member do
      match :preview, via: %i[get post]
      patch :rename
    end
  end

  get "up" => "rails/health#show", as: :rails_health_check
end
