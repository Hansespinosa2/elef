Rails.application.routes.draw do
  root "presentations#index"

  resources :snippets, except: :show

  resources :presentations do
    collection do
      post :load_samples
    end
    member do
      get :present
    end
  end

  get "up" => "rails/health#show", as: :rails_health_check
end
